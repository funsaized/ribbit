import { join } from 'node:path';
import { type Context, Budget } from '../../sdk/index.ts';
import { type RecordValue, RibbitError, validateRecord } from '../records/index.ts';
import { type Manifest } from '../../sdk/manifest/index.ts';
import { loadProjectInference, type Config, type Inference } from '../../config/index.ts';
import { resolveRoute, commandRoute, type Layer, type Route } from '../../routing/index.ts';
import { ManagedInference } from '../inference/index.ts';
import { OllamaAdapter } from '../../providers/ollama/index.ts';
import { CompatibleAdapter } from '../../providers/openai-compatible/index.ts';
import { dispatch } from '../../extensions/runtime/index.ts';
import { loadInstalled } from '../../extensions/install/index.ts';
import { builtins } from '../../catalog/index.ts';
import { collect } from '../../builtins/primitives.ts';
import { resolveCapabilities } from '../../sdk/capabilities.ts';

export type Data =
  | { kind: 'records'; records: AsyncIterable<RecordValue> }
  | { kind: 'text' | 'json'; value: unknown }
  | { kind: 'textStream'; chunks: AsyncIterable<string> };

export interface Invocation {
  name: string;
  manifest: Manifest;
  action: string;
  args: Record<string, any>;
  config: Record<string, unknown>;
  inference?: Inference;
}

export function invocationLayers(
  invocation: Invocation,
  config: Config,
  layers: Partial<Record<Layer, Inference>> = {},
) {
  return {
    perCommand: commandRoute(config, invocation.name, `${invocation.manifest.type}/${invocation.action}`),
    definition: invocation.inference,
    ...layers,
  };
}

export function routeFor(
  invocation: Invocation,
  config: Config,
  layers: Partial<Record<Layer, Inference>> = {},
  force?: string,
): Route | undefined {
  const action = invocation.manifest.actions[invocation.action];

  const requirements = resolveCapabilities(action, invocation.args);

  if (requirements.status === 'exact') return undefined;
  if (requirements.status === 'unresolved') throw new RibbitError(2, 'Resolve capability arguments before routing');

  return resolveRoute(
    config,
    invocationLayers(invocation, config, layers),
    force,
    requirements.capabilities,
    `${invocation.name}/${invocation.action}`,
  );
}

export async function runInvocation(
  invocation: Invocation,
  input: Data,
  budget: Budget,
  config: Config,
  layers: Partial<Record<Layer, Inference>> = {},
  force?: string,
  log: (message: string) => void = (message) => console.error(message),
): Promise<Data> {
  layers = { project: await loadProjectInference(join(process.cwd(), '.ribbit.yaml')), ...layers };
  const action = invocation.manifest.actions[invocation.action];

  if (!action) throw new RibbitError(2, 'Unknown action');
  let llm: ManagedInference | undefined;

  function inference(capability: 'text' | 'object') {
    const requirements = resolveCapabilities(action, invocation.args);

    if (requirements.status === 'unresolved' || !requirements.capabilities.includes(capability))
      throw new RibbitError(
        3,
        `${invocation.name}/${invocation.action} did not declare ${capability} for these arguments`,
      );
    if (!llm) {
      const route = routeFor(invocation, config, layers, force);

      if (!route) throw new RibbitError(3, 'Action did not declare inference');
      budget.routes.push({ provider: route.provider, model: route.model, source: route.source });
      llm = new ManagedInference(
        route.endpoint.type === 'ollama' ? new OllamaAdapter() : new CompatibleAdapter(),
        route,
        budget,
      );
    }

    return llm;
  }

  const ctx: Context = {
    inputKind: input.kind,
    budget,
    signal: budget.signal,
    log,
    llm: {
      text: (instruction, evidence) => inference('text').text(instruction, evidence),
      object: (instruction, evidence, schema) => inference('object').object(instruction, evidence, schema),
    },
  };

  if (input.kind === 'textStream') {
    let value = '';

    for await (const chunk of input.chunks) {
      value += chunk;
      if (Buffer.byteLength(value) > budget.limits.maxBytes)
        throw new RibbitError(6, 'Text stream exceeds input limit');
    }
    input = { kind: 'text', value };
  }
  let value: unknown;

  if (action.inputKind === 'records') {
    if (input.kind !== 'records')
      throw new RibbitError(2, 'This command requires records; use --input lines or --input jsonl');
    value = input.records;
  } else if (action.inputKind === 'none') value = null;
  else value = input.kind === 'records' ? await collect(input.records, budget.limits.maxRecords) : input.value;
  const name = Object.keys(builtins).find((key) => builtins[key].type === invocation.manifest.type);
  const command = name
    ? (await import('../../builtins/index.ts')).builtins[
        name as keyof typeof import('../../builtins/index.ts').builtins
      ]
    : await loadInstalled(invocation.manifest.type);
  let result: unknown;
  const pending = dispatch(command, invocation.action, value, invocation.args, invocation.config, ctx);
  let cleanup = () => {};
  const abort = new Promise<never>((_, reject) => {
    const listener = () => reject(budget.signal.reason);

    cleanup = () => budget.signal.removeEventListener('abort', listener);
    budget.signal.addEventListener('abort', listener, { once: true });
    if (budget.signal.aborted) listener();
  });

  try {
    result = await Promise.race([pending, abort]);
  } finally {
    cleanup();
  }
  if (action.outputKind === 'records') {
    const iterable =
      result && typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
        ? (result as AsyncIterable<unknown>)
        : (async function* () {
            if (!Array.isArray(result)) throw new RibbitError(5, 'Expected record array');
            yield* result;
          })();

    return {
      kind: 'records',
      records: (async function* () {
        const ids = new Set<string>();

        for await (const row of iterable) {
          budget.check();
          let record: RecordValue;

          try {
            record = validateRecord(row);
          } catch {
            throw new RibbitError(5, 'Invalid output record');
          }
          if (ids.has(record.id)) throw new RibbitError(5, 'Duplicate output record ID');
          budget.charge('records', 1);
          budget.charge('bytes', Buffer.byteLength(JSON.stringify(record)));
          ids.add(record.id);
          yield record;
        }
      })(),
    };
  }
  if (action.mode === 'text-stream')
    return {
      kind: 'textStream',
      chunks: (async function* () {
        for await (const chunk of result as AsyncIterable<string>) {
          budget.check();
          budget.charge('bytes', Buffer.byteLength(chunk));
          yield chunk;
        }
      })(),
    };

  return {
    kind:
      action.outputKind === 'json' || (action.outputKind === 'display' && typeof result !== 'string') ? 'json' : 'text',
    value: result,
  };
}
