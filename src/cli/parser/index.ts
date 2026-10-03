import { RUNTIME_FLAGS, type ActionManifest } from '../../sdk/manifest/index.ts';
import { validateJson } from '../../build/schema/index.ts';
import { RibbitError } from '../../engine/records/index.ts';

export type Runtime = Record<string, string | number | boolean>;

export const booleans = new Set(['help', 'version', 'stats']);

export const numbers = new Set(['max-bytes', 'max-records', 'max-requests', 'max-tokens', 'total-ms', 'request-ms']);

export const scalarTypes = new Set(['string', 'number', 'integer', 'boolean']);

export function parseAction(
  tokens: string[],
  action: ActionManifest,
  defaults: Record<string, unknown> = {},
): { args: any; runtime: Runtime } {
  const args: Record<string, unknown> = {},
    runtime: Runtime = {},
    assigned = new Set<string>();
  const positionals = action.bindings
    .filter((b) => b.positional !== undefined)
    .toSorted((a, b) => a.positional! - b.positional!);
  let position = 0,
    literal = false;

  function scalar(value: string, type: string) {
    if (!scalarTypes.has(type)) throw new RibbitError(2, 'Complex arguments require --args-json');
    if (type === 'boolean') {
      if (!['true', 'false'].includes(value)) throw new RibbitError(2, 'Expected true or false');

      return value === 'true';
    }
    if (type === 'number' || type === 'integer') {
      if (value.trim() === '' || !Number.isFinite(Number(value))) throw new RibbitError(2, 'Expected finite number');

      return Number(value);
    }

    return value;
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '--' && !literal) {
      literal = true;
      continue;
    }
    if (token.startsWith('--') && !literal) {
      const eq = token.indexOf('='),
        flag = token.slice(2, eq < 0 ? undefined : eq);
      let value = eq < 0 ? undefined : token.slice(eq + 1);

      if (flag === 'args-json') {
        value ??= tokens[++i];
        if (value === undefined) throw new RibbitError(2, '--args-json requires an object');
        let json: any;

        try {
          json = JSON.parse(value);
        } catch {
          throw new RibbitError(2, 'Invalid --args-json');
        }
        if (!json || typeof json !== 'object' || Array.isArray(json))
          throw new RibbitError(2, '--args-json requires an object');
        for (const [field, v] of Object.entries(json)) {
          if (assigned.has(field)) throw new RibbitError(2, `Duplicate argument: ${field}`, 'args.' + field);
          args[field] = v;
          assigned.add(field);
          assigned.add('json:' + field);
        }
        continue;
      }
      if (RUNTIME_FLAGS.has(flag)) {
        if (Object.hasOwn(runtime, flag)) throw new RibbitError(2, `Duplicate runtime flag --${flag}`);
        if (booleans.has(flag)) runtime[flag] = value === undefined ? true : (scalar(value, 'boolean') as boolean);
        else {
          value ??= tokens[++i];
          if (value === undefined) throw new RibbitError(2, `--${flag} requires a value`);
          runtime[flag] = numbers.has(flag) ? (scalar(value, 'integer') as number) : value;
        }
        continue;
      }
      const binding = action.bindings.find((b) => b.flag === flag);

      if (!binding) throw new RibbitError(2, `Unknown argument --${flag}`, 'args.' + flag);
      if (binding.type === 'boolean' && !binding.repeated && value === undefined) value = 'true';
      else value ??= tokens[++i];
      if (value === undefined) throw new RibbitError(2, `--${flag} requires a value`, 'args.' + binding.field);
      if (assigned.has(binding.field) && !binding.repeated)
        throw new RibbitError(2, `Duplicate argument ${binding.field}`);
      if (assigned.has(binding.field) && binding.repeated && !Array.isArray(args[binding.field]))
        throw new RibbitError(2, `Duplicate argument ${binding.field}`);
      const parsed = scalar(value, binding.type);

      if (binding.repeated) {
        if (assigned.has('json:' + binding.field)) throw new RibbitError(2, 'Conflicting --args-json and field flag');
        args[binding.field] = [...((args[binding.field] as unknown[]) ?? []), parsed];
      } else args[binding.field] = parsed;
      assigned.add(binding.field);
    } else {
      const binding = positionals[position];

      if (!binding) throw new RibbitError(2, `Unexpected positional argument: ${token}`);
      if (assigned.has(binding.field) && !binding.repeated)
        throw new RibbitError(2, 'Conflicting positional and field argument');
      if (assigned.has('json:' + binding.field))
        throw new RibbitError(2, 'Conflicting --args-json and positional argument');
      if (binding.repeated)
        args[binding.field] = [...((args[binding.field] as unknown[]) ?? []), scalar(token, binding.type)];
      else {
        args[binding.field] = scalar(token, binding.type);
        position++;
      }
      assigned.add(binding.field);
    }
  }

  return { args: validateJson(action.args, { ...defaults, ...args }), runtime };
}
