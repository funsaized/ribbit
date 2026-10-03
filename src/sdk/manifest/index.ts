import { z } from 'zod';
import { createHash } from 'node:crypto';
import { canonical, type Json, RibbitError } from '../../engine/records/index.ts';
import type { Action } from '../index.ts';
import { validateCapabilities, type Capabilities } from '../capabilities.ts';

export function schemaToJson(schema: z.ZodType): Record<string, unknown> {
  const seen = new Set<z.ZodType>();

  function visit(node: z.ZodType) {
    if (seen.has(node)) throw new RibbitError(2, 'Recursive schemas are unsupported');
    seen.add(node);
    const def = node._zod.def as Record<string, any>;

    if (def.type === 'unknown' && node.meta()?.ribbitJson === true) {
      seen.delete(node);

      return;
    }
    if (def.type === 'record' && node.meta()?.ribbitDictionary === true) {
      visit(def.keyType);
      visit(def.valueType);
      seen.delete(node);

      return;
    }
    if (
      ![
        'string',
        'number',
        'boolean',
        'null',
        'array',
        'object',
        'enum',
        'literal',
        'optional',
        'default',
        'union',
      ].includes(def.type)
    )
      throw new RibbitError(2, `Unsupported schema type: ${def.type}`);
    for (const check of def.checks ?? [])
      if (check._zod.def.check === 'custom') throw new RibbitError(2, 'Custom schema refinements are unsupported');
    if (def.type === 'object') {
      if (def.catchall?._zod.def.type !== 'never') throw new RibbitError(2, 'Schema objects must be strict');
      for (const child of Object.values(def.shape)) visit(child as z.ZodType);
    }
    if (def.element) visit(def.element);
    if (def.innerType) visit(def.innerType);
    if (def.options) for (const child of def.options) visit(child);
    seen.delete(node);
  }

  visit(schema);
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    throw new RibbitError(2, 'Schema cannot be represented as JSON Schema');
  }
}

export const RUNTIME_FLAGS = new Set([
  'input',
  'output',
  'file',
  'profile',
  'provider',
  'model',
  'force-profile',
  'stats',
  'error-format',
  'help',
  'version',
  'args-json',
  'max-bytes',
  'max-records',
  'max-requests',
  'max-tokens',
  'total-ms',
  'request-ms',
]);

export type JsonSchema = Record<string, any>;

export interface Binding {
  field: string;
  flag: string;
  type: string;
  repeated: boolean;
  positional?: number;
}

export interface ActionManifest {
  description: string;
  args: JsonSchema;
  input: JsonSchema;
  output: JsonSchema;
  mode: string;
  capabilities: Capabilities;
  effects: string[];
  bindings: Binding[];
  inputKind: 'text' | 'records' | 'none' | 'any';
  outputKind: 'text' | 'records' | 'json' | 'display';
  barrier: boolean;
  examples: string[];
}

export interface Manifest {
  schemaVersion: 1;
  sdkVersion: string;
  type: string;
  version: string;
  description: string;
  sourceHash: string;
  dependencies: Record<string, string>;
  config: JsonSchema;
  actions: Record<string, ActionManifest>;
}

export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stable(value: unknown): string {
  return canonical(value as Json);
}

export function manifest(
  command: { type: string; version: string; description: string; config: z.ZodType; actions: Record<string, Action> },
  sourceHash: string,
  dependencies: Record<string, string> = {},
): Manifest {
  const actions: Record<string, ActionManifest> = {};

  for (const [name, action] of Object.entries(command.actions)) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new RibbitError(2, 'Invalid action name');
    const args = schemaToJson(action.args) as JsonSchema;

    if (args.type !== 'object') throw new RibbitError(2, 'Action args must be a strict object');
    const flags = new Set<string>();
    const positions = action.cli?.positionals ?? [];

    if (new Set(positions).size !== positions.length || positions.some((p) => !Object.hasOwn(args.properties ?? {}, p)))
      throw new RibbitError(2, 'Invalid positional mapping');
    const bindings = Object.entries(args.properties ?? {}).map(([field, raw]) => {
      const property = raw as JsonSchema;
      const flag = field.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`);

      if (RUNTIME_FLAGS.has(flag) || flags.has(flag) || !/^[a-z][a-z0-9-]*$/.test(flag))
        throw new RibbitError(2, `Reserved or colliding flag: --${flag}`);
      flags.add(flag);
      const repeated =
        property.type === 'array' && ['string', 'number', 'integer', 'boolean'].includes(property.items?.type);
      const type = repeated ? property.items.type : (property.type ?? 'json');

      return {
        field,
        flag,
        type,
        repeated,
        ...(positions.includes(field) ? { positional: positions.indexOf(field) } : {}),
      };
    });

    if (Object.hasOwn(action, 'inferenceWhen'))
      throw new RibbitError(2, 'Replace inferenceWhen with a conditional capability declaration');
    actions[name] = {
      description: action.description,
      args,
      input: schemaToJson(action.input),
      output: schemaToJson(action.output),
      mode: action.mode,
      capabilities: validateCapabilities(action.capabilities, args),
      effects: [...action.effects],
      bindings,
      inputKind: action.inputKind ?? (action.mode === 'records' ? 'records' : 'any'),
      outputKind:
        action.outputKind ?? (action.mode === 'records' ? 'records' : action.mode === 'text-stream' ? 'text' : 'json'),
      barrier: action.barrier ?? action.mode === 'value',
      examples: action.examples ?? [],
    };
  }
  const result: Manifest = {
    schemaVersion: 1,
    sdkVersion: '0.1.0',
    type: command.type,
    version: command.version,
    description: command.description,
    sourceHash,
    dependencies,
    config: schemaToJson(command.config),
    actions,
  };

  stable(result);

  return result;
}
