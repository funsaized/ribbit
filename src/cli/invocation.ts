import { resolveInvocation } from '../definitions/index.ts';
import { loadDotenv } from '../config/index.ts';
import { RibbitError, EXACT_LIMITS, SEMANTIC_LIMITS } from '../engine/records/index.ts';
import { resolveLimits } from '../engine/execution/index.ts';
import { resolveCapabilities } from '../sdk/capabilities.ts';
import { parseAction } from './parser/index.ts';
import { ADMIN } from './admin/contract.ts';
import { actionHelp } from './help.ts';

export async function prepareInvocation(tokens: string[]) {
  const explicit = tokens[0] === 'run';
  const name = tokens[explicit ? 1 : 0];

  if (!name || (!explicit && (ADMIN.has(name) || name === 'flow')))
    throw new RibbitError(2, 'Expected COMMAND [arguments] or run NAME [arguments]; use flow plan for flows');
  const args = tokens.slice(explicit ? 2 : 1);
  const help = args.slice(0, args.indexOf('--') < 0 ? undefined : args.indexOf('--')).includes('--help');

  // Dotenv can locate global definitions, but help must not depend on credential configuration.
  if (!help) loadDotenv();
  const invocation = await resolveInvocation(name);
  const action = invocation.manifest.actions[invocation.action];

  if (help)
    return {
      help: actionHelp(explicit ? `run ${name}` : name, invocation.manifest, invocation.action, invocation.args),
    };
  const parsed = parseAction(args, action, invocation.args);

  invocation.args = parsed.args;
  const runtime = parsed.runtime;

  if (runtime['force-profile'] !== undefined) throw new RibbitError(2, '--force-profile applies only to flows');
  if (runtime['error-format'] !== undefined && !['json', 'text'].includes(String(runtime['error-format'])))
    throw new RibbitError(2, 'Unknown error format');
  if (runtime.input !== undefined && !['auto', 'text', 'lines', 'jsonl', 'records'].includes(String(runtime.input)))
    throw new RibbitError(2, 'Unknown input mode');
  if (runtime.output !== undefined && !['records', 'jsonl', 'text', 'json'].includes(String(runtime.output)))
    throw new RibbitError(2, 'Unknown output format');
  if (
    action.outputKind === 'records' &&
    runtime.output !== undefined &&
    !['records', 'jsonl'].includes(String(runtime.output))
  )
    throw new RibbitError(2, 'Use render for record display');
  if (action.inputKind === 'none' && runtime.file !== undefined)
    throw new RibbitError(2, 'This command owns explicit files; --file is not allowed');
  const inference = resolveCapabilities(action, invocation.args);
  const semantic = inference.status !== 'exact';
  const defaults = semantic ? SEMANTIC_LIMITS : EXACT_LIMITS;
  const limits = resolveLimits({
    maxBytes: Number(runtime['max-bytes'] ?? defaults.maxBytes),
    maxRecords: Number(runtime['max-records'] ?? defaults.maxRecords),
    ...(runtime['max-requests'] === undefined ? {} : { maxRequests: Number(runtime['max-requests']) }),
    ...(runtime['max-tokens'] === undefined ? {} : { maxTokens: Number(runtime['max-tokens']) }),
    ...(runtime['total-ms'] === undefined ? {} : { totalMs: Number(runtime['total-ms']) }),
    ...(runtime['request-ms'] === undefined ? {} : { requestMs: Number(runtime['request-ms']) }),
  });
  const cli = {
    ...(runtime.profile === undefined ? {} : { profile: String(runtime.profile) }),
    ...(runtime.provider === undefined ? {} : { provider: String(runtime.provider) }),
    ...(runtime.model === undefined ? {} : { model: String(runtime.model) }),
  };

  return { invocation, action, runtime, cli, inference, semantic, limits };
}

export type PreparedInvocation = Extract<Awaited<ReturnType<typeof prepareInvocation>>, { invocation: unknown }>;
