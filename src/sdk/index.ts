import { z } from 'zod';
import type { Capabilities } from './capabilities.ts';
import { Budget, abortable, cancellable } from '../engine/execution/index.ts';
import { RibbitError, isJson } from '../engine/records/index.ts';

export type { Capabilities } from './capabilities.ts';

export { z, Budget, RibbitError };

export { recordSchema, jsonValueSchema } from '../engine/records/index.ts';

export type { RecordValue, Json } from '../engine/records/index.ts';

export interface Context {
  inputKind?: 'records' | 'text' | 'json' | 'textStream';
  signal: AbortSignal;
  budget: Budget;
  log(message: string): void;
  llm: {
    text(instruction: string, evidence: string): Promise<string>;
    object<T>(instruction: string, evidence: string, schema: z.ZodType<T>): Promise<T>;
  };
}

export type Mode = 'value' | 'records' | 'text-stream';

type Incoming<I extends z.ZodType, M extends Mode> = M extends 'records' ? AsyncIterable<z.output<I>> : z.output<I>;
type Outgoing<O extends z.ZodType, M extends Mode> = M extends 'value'
  ? Promise<z.output<O>> | z.output<O>
  : AsyncIterable<z.output<O>>;

export function defineAction<
  C extends z.ZodType,
  A extends z.ZodType,
  I extends z.ZodType,
  O extends z.ZodType,
  M extends Mode,
>(spec: {
  config: C;
  description: string;
  args: A;
  input: I;
  output: O;
  mode: M;
  capabilities: Capabilities;
  effects: string[];
  cli?: { positionals?: string[] };
  inputKind?: 'text' | 'records' | 'none' | 'any';
  outputKind?: 'text' | 'records' | 'json' | 'display';
  barrier?: boolean;
  examples?: string[];
  execute(input: { config: z.output<C>; args: z.output<A>; input: Incoming<I, M> }, ctx: Context): Outgoing<O, M>;
}) {
  return spec;
}

export type Action = ReturnType<typeof defineAction<z.ZodType, z.ZodType, z.ZodType, z.ZodType, Mode>>;

export function defineCommand<C extends z.ZodType, A extends Record<string, Action>>(spec: {
  type: string;
  version: string;
  description: string;
  config: C;
  actions: A;
}) {
  if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(spec.type)) throw new RibbitError(2, 'Command type must be a scoped ID');
  if (!/^\d+\.\d+\.\d+$/.test(spec.version))
    throw new RibbitError(2, 'Command version must be an exact semantic version');
  if (Object.keys(spec.actions).length === 0) throw new RibbitError(2, 'Command must declare an action');
  for (const action of Object.values(spec.actions))
    if (action.config !== spec.config) throw new RibbitError(2, 'Actions must use the command config schema');

  return spec;
}

export function parse<T>(schema: z.ZodType<T>, value: unknown, location: string, code = 2): T {
  if (!isJson(value)) throw new RibbitError(code, 'Expected finite JSON value', location);
  const result = schema.safeParse(value);

  if (!result.success) throw new RibbitError(code, result.error.message, location);
  if (!isJson(result.data)) throw new RibbitError(code, 'Schema produced non-JSON value', location);

  return result.data;
}

export async function executeAction(
  action: Action,
  input: unknown,
  args: unknown,
  config: unknown,
  ctx: Context,
): Promise<unknown> {
  ctx.budget.check();
  const parsedArgs = parse(action.args, args, 'args'),
    parsedConfig = parse(action.config, config, 'config');
  const inputSchema = action.input;

  async function* validatedInput(source: AsyncIterable<unknown>) {
    for await (const item of cancellable(source, ctx.signal)) {
      ctx.budget.check();
      yield parse(inputSchema, item, 'input');
    }
  }

  if (
    action.mode === 'records' &&
    !(input && typeof (input as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function')
  )
    throw new RibbitError(2, 'Record action requires an async iterable', 'input');
  const parsedInput =
    action.mode === 'records' ? validatedInput(input as AsyncIterable<unknown>) : parse(inputSchema, input, 'input');
  let result: unknown;

  try {
    result = await abortable(
      Promise.resolve(action.execute({ input: parsedInput, args: parsedArgs, config: parsedConfig }, ctx)),
      ctx.signal,
    );
  } catch (error) {
    if (error instanceof RibbitError) throw error;
    throw new RibbitError(5, 'Extension execution failed (details redacted)');
  }
  if (action.mode === 'value') return parse(action.output, result, 'output', 5);
  if (!result || typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function')
    throw new RibbitError(5, 'Streaming action did not return an async iterable');

  return (async function* () {
    try {
      for await (const item of cancellable(result as AsyncIterable<unknown>, ctx.signal)) {
        ctx.budget.check();
        const output = parse(action.output, item, 'output', 5);

        if (action.mode === 'text-stream' && typeof output !== 'string')
          throw new RibbitError(5, 'Text stream must emit strings');
        yield output;
      }
    } catch (error) {
      if (error instanceof RibbitError) throw error;
      throw new RibbitError(5, 'Extension stream failed (details redacted)');
    }
  })();
}
