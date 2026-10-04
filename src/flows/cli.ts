import { yamlFile } from '../definitions/index.ts';
import { loadConfig } from '../config/index.ts';
import { Budget } from '../sdk/index.ts';
import { RibbitError, SEMANTIC_LIMITS, EXACT_LIMITS } from '../engine/records/index.ts';
import { planFlow, executeFlow, canSkipFlowInput } from './index.ts';
import { parseAction, type Runtime } from '../cli/parser/index.ts';
import { resolveInvocation } from '../definitions/index.ts';
import { readInput, write, output } from '../cli/io/index.ts';

export async function flowCli(tokens: string[]): Promise<void> {
  const operation = tokens.shift();

  if (!['run', 'plan', 'validate'].includes(operation ?? ''))
    throw new RibbitError(2, 'Usage: ribbit flow run|plan|validate FILE or -- COMMAND :: COMMAND');
  let raw: unknown,
    runtime: Runtime = {};
  const separator = tokens.indexOf('--');

  if (separator >= 0) {
    const options = tokens.slice(0, separator),
      segments: string[][] = [[]];

    for (const token of tokens.slice(separator + 1)) {
      if (token === '::') segments.push([]);
      else segments.at(-1)!.push(token);
    }
    const steps = [];

    for (const [i, segment] of segments.entries()) {
      if (!segment.length) throw new RibbitError(2, 'Empty flow segment');
      const invocation = await resolveInvocation(segment[0]);
      const parsed = parseAction(segment.slice(1), invocation.manifest.actions[invocation.action], invocation.args);

      if (Object.keys(parsed.runtime).some((k) => !['profile', 'provider', 'model'].includes(k)))
        throw new RibbitError(2, 'Flow input/output and budget flags must precede --');
      steps.push({ id: `step${i + 1}`, command: segment[0], args: parsed.args, inference: parsed.runtime });
    }
    raw = { apiVersion: 'ribbit/v1', kind: 'Flow', name: 'inline', steps };
    tokens = options;
  } else {
    const file = tokens.shift();

    if (!file) throw new RibbitError(2, 'Flow file required');
    raw = await yamlFile(file);
  }
  const dummy = (await resolveInvocation('ask')).manifest.actions.run;
  // Reuse runtime flag validation without accepting action arguments here.
  const parsed = parseAction(tokens, { ...dummy, args: { type: 'object', additionalProperties: false }, bindings: [] });

  runtime = parsed.runtime;
  const config = await loadConfig(),
    plan = await planFlow(
      raw,
      config,
      runtime['force-profile'] ? String(runtime['force-profile']) : undefined,
      Object.fromEntries(
        ['profile', 'provider', 'model'].filter((k) => runtime[k] !== undefined).map((k) => [k, String(runtime[k])]),
      ),
    );

  if (runtime.output && !['records', 'jsonl', 'text', 'json'].includes(String(runtime.output)))
    throw new RibbitError(2, 'Unknown output format');
  if (runtime.input && !['auto', 'text', 'lines', 'jsonl', 'records'].includes(String(runtime.input)))
    throw new RibbitError(2, 'Unknown input format');
  if (runtime['error-format'] && !['json', 'text'].includes(String(runtime['error-format'])))
    throw new RibbitError(2, 'Unknown error format');
  const semantic = plan.steps.some((s) => s.inference.status !== 'exact'),
    limits = semantic ? SEMANTIC_LIMITS : EXACT_LIMITS;
  const budget = new Budget({
    ...limits,
    ...Object.fromEntries(
      [
        ['max-bytes', 'maxBytes'],
        ['max-records', 'maxRecords'],
        ['max-requests', 'maxRequests'],
        ['max-tokens', 'maxTokens'],
        ['total-ms', 'totalMs'],
        ['request-ms', 'requestMs'],
      ]
        .filter(([flag]) => runtime[flag] !== undefined)
        .map(([flag, key]) => [key, Number(runtime[flag])]),
    ),
  });

  if (operation === 'validate') {
    budget.close();
    const deferred = plan.steps.flatMap((step, i) =>
      step.inference.status === 'unresolved' ? [{ id: plan.flow.steps[i].id, ...step.inference }] : [],
    );

    console.log(
      JSON.stringify({ schemaVersion: 1, valid: true, name: plan.flow.name, complete: !deferred.length, deferred }),
    );

    return;
  }
  if (operation === 'plan') {
    budget.close();
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          name: plan.flow.name,
          limits: budget.limits,
          forceProfile: plan.force ?? null,
          steps: plan.steps.map((s, i) => ({
            id: plan.flow.steps[i].id,
            command: s.invocation.name,
            args: s.invocation.args,
            input: s.binding,
            inference: s.inference,
            route: s.route,
            boundary: s.barrier ? 'barrier' : 'streaming',
            effects: s.invocation.manifest.actions[s.invocation.action].effects,
          })),
        },
        null,
        2,
      ),
    );

    return;
  }
  const cancel = () => budget.controller.abort(new RibbitError(130, 'Cancelled'));

  process.once('SIGINT', cancel);
  try {
    const first = plan.steps[0],
      action = first.invocation.manifest.actions[first.invocation.action];
    const input = await readInput(runtime, action, first.invocation.args, semantic, canSkipFlowInput(plan));

    await write(output(await executeFlow(plan, input, budget, config), runtime, plan.steps.at(-1)!.invocation.name));
  } finally {
    process.removeListener('SIGINT', cancel);
    budget.close();
    if (runtime.stats)
      console.error(
        JSON.stringify({
          schemaVersion: 1,
          requests: budget.requests,
          repairs: budget.repairs,
          retries: budget.retries,
          routes: budget.routes,
          tokens: budget.usageUnknown ? 'unknown' : budget.tokens,
          elapsedMs: performance.now() - budget.started,
        }),
      );
  }
}
