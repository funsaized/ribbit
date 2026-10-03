import { z } from 'zod';
import { inferenceSchema, type Config, type Inference, loadProjectInference } from '../config/index.ts';
import { resolveInvocation } from '../definitions/index.ts';
import { validateJson } from '../build/schema/index.ts';
import { RibbitError } from '../engine/records/index.ts';
import { runInvocation, routeFor, type Data, type Invocation } from '../engine/runtime/index.ts';
import { inspectRoute } from '../routing/index.ts';
import type { Budget } from '../sdk/index.ts';
import { resolveCapabilities, type CapabilityResolution } from '../sdk/capabilities.ts';

const stepSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  command: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  input: z.unknown().optional(),
  inference: inferenceSchema.optional(),
});

export const flowSchema = z.strictObject({
  apiVersion: z.literal('ribbit/v1'),
  kind: z.literal('Flow'),
  name: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  inference: inferenceSchema.optional(),
  steps: z.array(stepSchema).min(1).max(100),
  output: z.unknown().optional(),
});

type Flow = z.infer<typeof flowSchema>;

export interface Plan {
  flow: Flow;
  steps: {
    invocation: Invocation;
    binding: unknown;
    inference: CapabilityResolution & { references?: string[] };
    route: unknown;
    barrier: boolean;
  }[];
  force?: string;
  inference?: Inference;
  project?: Inference;
}

function reference(value: string) {
  const match = /^(input|steps\.([A-Za-z][A-Za-z0-9_-]*)\.output)((?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*)$/.exec(value);

  if (!match) throw new RibbitError(2, 'Invalid flow reference', value);
  const path = match[3].match(/[A-Za-z_][A-Za-z0-9_-]*|\d+/g) ?? [];

  if (path.some((p) => ['__proto__', 'constructor', 'prototype'].includes(p)))
    throw new RibbitError(2, 'Unsafe reference path');

  return { key: match[2] ?? 'input', path };
}

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, '$ref')) {
      if (Object.keys(value).length !== 1 || typeof (value as any).$ref !== 'string')
        throw new RibbitError(2, 'Reference must contain only a string $ref');

      return [(value as any).$ref];
    }

    return Object.values(value).flatMap(refs);
  }

  return [];
}

function refSchema(ref: string, schemas: Map<string, any>): any {
  const parsed = reference(ref);
  let schema = schemas.get(parsed.key);

  for (const part of parsed.path) {
    if (!schema || !Object.keys(schema).length) return {};
    if (schema.type === 'array' && /^\d+$/.test(part)) schema = schema.items;
    else if (schema.properties?.[part]) schema = schema.properties[part];
    else if (schema.additionalProperties === false) throw new RibbitError(2, 'Reference path absent from schema', ref);
    else return {};
  }

  return schema ?? {};
}

function mismatch(source: any, target: any): boolean {
  if (!source || !target || !Object.keys(source).length || !Object.keys(target).length) return false;
  const a = Array.isArray(source.type) ? source.type : [source.type].filter(Boolean),
    b = Array.isArray(target.type) ? target.type : [target.type].filter(Boolean);

  if (a.length && b.length && !a.some((t: string) => b.includes(t) || (t === 'integer' && b.includes('number'))))
    return true;
  if (a.includes('array') && b.includes('array') && source.items && target.items)
    return mismatch(source.items, target.items);

  return false;
}

function validateBindings(value: any, schema: any, schemas: Map<string, any>, location: string) {
  if (value && typeof value === 'object' && Object.hasOwn(value, '$ref')) {
    if (mismatch(refSchema(value.$ref, schemas), schema))
      throw new RibbitError(2, 'Reference schema mismatch', location);

    return;
  }
  if (!refs(value).length) {
    validateJson(schema, value, location);

    return;
  }
  if (Array.isArray(value)) {
    if (schema.type && schema.type !== 'array') throw new RibbitError(2, 'Binding schema mismatch', location);
    if (schema.items) value.forEach((v, i) => validateBindings(v, schema.items, schemas, `${location}[${i}]`));

    return;
  }
  if (value && typeof value === 'object') {
    if (schema.type && schema.type !== 'object') throw new RibbitError(2, 'Binding schema mismatch', location);
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(value, key) && schema.properties?.[key]?.default === undefined)
        throw new RibbitError(2, 'Missing required argument', `${location}.${key}`);
    for (const [key, v] of Object.entries(value)) {
      const target = schema.properties?.[key];

      if (!target && schema.additionalProperties === false)
        throw new RibbitError(2, 'Unknown argument', `${location}.${key}`);
      if (target) validateBindings(v, target, schemas, `${location}.${key}`);
    }
  }
}

export async function planFlow(raw: unknown, config: Config, force?: string, inference?: Inference): Promise<Plan> {
  const parsed = flowSchema.safeParse(raw);

  if (!parsed.success) throw new RibbitError(2, parsed.error.message);
  const project = await loadProjectInference(process.cwd() + '/.ribbit.yaml');
  const flow = parsed.data,
    steps: Plan['steps'] = [],
    seen = new Set(['input']),
    schemas = new Map<string, any>([['input', flow.input]]);

  for (const [i, step] of flow.steps.entries()) {
    if (seen.has(step.id)) throw new RibbitError(2, 'Duplicate or reserved step ID', step.id);
    const invocation = await resolveInvocation(step.command);
    const binding =
      step.input === undefined
        ? invocation.manifest.actions[invocation.action].inputKind === 'none'
          ? null
          : { $ref: i ? `steps.${flow.steps[i - 1].id}.output` : 'input' }
        : step.input;

    for (const ref of [...refs(binding), ...refs(step.args)])
      if (!seen.has(reference(ref).key)) throw new RibbitError(2, 'Missing or future flow reference', ref);
    const defaults = Object.fromEntries(
      Object.entries(invocation.manifest.actions[invocation.action].args.properties ?? {})
        .filter(([, property]) => Object.hasOwn(property as object, 'default'))
        .map(([field, property]) => [field, structuredClone((property as { default: unknown }).default)]),
    );

    invocation.args = { ...defaults, ...invocation.args, ...step.args };
    if (!refs(step.args).length)
      invocation.args = validateJson(
        invocation.manifest.actions[invocation.action].args,
        invocation.args,
        `steps.${step.id}.args`,
      );
    const action = invocation.manifest.actions[invocation.action];

    if (refs(step.args).length) validateBindings(invocation.args, action.args, schemas, `steps.${step.id}.args`);
    for (const ref of [...refs(binding), ...refs(step.args)]) refSchema(ref, schemas);
    if (binding && typeof binding === 'object' && Object.hasOwn(binding, '$ref')) {
      const source = refSchema((binding as any).$ref, schemas),
        target = action.inputKind === 'records' ? { type: 'array', items: action.input } : action.input;

      if (action.inputKind !== 'none' && mismatch(source, target))
        throw new RibbitError(2, 'Flow input schema mismatch', step.id);
    }
    schemas.set(
      step.id,
      action.outputKind === 'records' && action.mode === 'records'
        ? { type: 'array', items: action.output }
        : action.output,
    );
    const requirements = resolveCapabilities(
      action,
      invocation.args,
      new Set(Object.keys(invocation.args).filter((field) => refs(invocation.args[field]).length > 0)),
    );
    const route =
      requirements.status === 'unresolved'
        ? undefined
        : routeFor(
            invocation,
            config,
            { project, savedFlow: flow.inference, invocationFlow: inference, step: step.inference },
            force,
          );

    steps.push({
      invocation,
      binding,
      inference:
        requirements.status === 'unresolved'
          ? { ...requirements, references: requirements.arguments.flatMap((field) => refs(invocation.args[field])) }
          : requirements,
      route: route ? inspectRoute(route) : null,
      barrier: action.barrier,
    });
    seen.add(step.id);
  }
  for (const ref of refs(flow.output)) {
    if (!seen.has(reference(ref).key)) throw new RibbitError(2, 'Missing output reference', ref);
    refSchema(ref, schemas);
  }

  return { flow, steps, force, inference, project };
}

async function materialize(data: Data, budget: Budget): Promise<unknown> {
  if (data.kind === 'records') {
    const rows = [];

    for await (const row of data.records) {
      if (rows.length >= budget.limits.maxRecords) throw new RibbitError(6, 'Flow barrier exceeds record limit');
      rows.push(row);
    }

    return rows;
  }
  if (data.kind === 'textStream') {
    let text = '';

    for await (const chunk of data.chunks) {
      text += chunk;
      if (Buffer.byteLength(text) > budget.limits.maxBytes) throw new RibbitError(6, 'Flow barrier exceeds byte limit');
    }

    return text;
  }

  return data.value;
}

export async function executeFlow(plan: Plan, input: Data, budget: Budget, config: Config): Promise<Data> {
  const data = new Map<string, Data>([['input', input]]),
    cache = new Map<string, Promise<unknown>>();
  const uses = new Map<string, number>();

  for (const ref of [
    ...plan.steps.flatMap((s) => [...refs(s.binding), ...refs(s.invocation.args)]),
    ...refs(plan.flow.output === undefined ? { $ref: `steps.${plan.flow.steps.at(-1)!.id}.output` } : plan.flow.output),
  ]) {
    const key = reference(ref).key;

    uses.set(key, (uses.get(key) ?? 0) + 1);
  }

  async function value(key: string) {
    if (!cache.has(key)) cache.set(key, materialize(data.get(key)!, budget));

    return cache.get(key);
  }

  async function bind(binding: unknown): Promise<any> {
    if (Array.isArray(binding)) return Promise.all(binding.map(bind));
    if (binding && typeof binding === 'object') {
      if (Object.hasOwn(binding, '$ref')) {
        const ref = reference((binding as any).$ref);
        let result = await value(ref.key);

        for (const part of ref.path) {
          if (result === null || typeof result !== 'object' || !Object.hasOwn(result, part))
            throw new RibbitError(2, 'Missing reference path', (binding as any).$ref);
          result = (result as any)[part];
        }

        return result;
      }

      return Object.fromEntries(await Promise.all(Object.entries(binding).map(async ([k, v]) => [k, await bind(v)])));
    }

    return binding;
  }

  function wrap(v: unknown, kind: string): Data {
    return kind === 'records'
      ? {
          kind: 'records',
          records: (async function* () {
            if (!Array.isArray(v)) throw new RibbitError(2, 'Record binding requires an array');
            yield* v;
          })(),
        }
      : { kind: typeof v === 'string' ? 'text' : 'json', value: v };
  }

  if (Object.keys(plan.flow.input).length) validateJson(plan.flow.input, await value('input'), 'input');
  for (const [i, step] of plan.steps.entries()) {
    budget.check();
    const action = step.invocation.manifest.actions[step.invocation.action],
      binding = step.binding;
    // Materialize bindings once so fan-out and later references never consume an exhausted iterator.
    let boundInput: Data;
    const direct =
      binding && typeof binding === 'object' && Object.hasOwn(binding, '$ref')
        ? reference((binding as any).$ref)
        : undefined;

    if (i > 0) {
      const previous = plan.flow.steps[i - 1].id;

      if (direct?.key !== previous || direct.path.length || action.inputKind === 'none') await value(previous);
    }
    if (direct && !direct.path.length && uses.get(direct.key) === 1 && !cache.has(direct.key))
      boundInput = data.get(direct.key)!;
    else boundInput = wrap(await bind(binding), action.inputKind);
    const invocation = { ...step.invocation, args: await bind(step.invocation.args) };

    invocation.args = validateJson(action.args, invocation.args, `steps.${plan.flow.steps[i].id}.args`);
    data.set(
      plan.flow.steps[i].id,
      await runInvocation(
        invocation,
        boundInput,
        budget,
        config,
        {
          project: plan.project,
          savedFlow: plan.flow.inference,
          invocationFlow: plan.inference,
          step: plan.flow.steps[i].inference,
        },
        plan.force,
      ),
    );
  }
  const last = plan.flow.steps.at(-1)!.id;

  if (!uses.has(last)) await value(last);
  if (plan.flow.output === undefined) return data.get(last)!;
  const out = plan.flow.output;

  if (out && typeof out === 'object' && Object.hasOwn(out, '$ref')) {
    const ref = reference((out as any).$ref);

    if (!ref.path.length) {
      if (!cache.has(ref.key)) return data.get(ref.key)!;

      return wrap(await value(ref.key), data.get(ref.key)!.kind);
    }
  }

  return wrap(await bind(out), 'any');
}

export function canSkipFlowInput(plan: Plan): boolean {
  const first = plan.steps[0];

  return (
    first.invocation.name === 'take' &&
    first.invocation.args.count === 0 &&
    Object.keys(plan.flow.input).length === 0 &&
    ![
      ...plan.steps.slice(1).flatMap((s) => [...refs(s.binding), ...refs(s.invocation.args)]),
      ...refs(plan.flow.output),
    ].some((ref) => reference(ref).key === 'input')
  );
}
