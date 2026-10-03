import { RUNTIME_FLAGS, type ActionManifest, type JsonSchema, type Manifest } from '../sdk/manifest/index.ts';
import { DEFAULT_BUDGET } from '../engine/execution/index.ts';
import { EXACT_LIMITS, SEMANTIC_LIMITS, RibbitError } from '../engine/records/index.ts';
import { booleans, numbers, scalarTypes } from './parser/index.ts';
import { MANAGEMENT, MANAGEMENT_FLAGS, managementBooleans } from './admin/contract.ts';

function schemaType(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map((value: unknown) => JSON.stringify(value)).join('|');
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const);
  if (schema.anyOf) return schema.anyOf.map(schemaType).join('|');

  return Array.isArray(schema.type) ? schema.type.join('|') : (schema.type ?? 'json');
}

export function runtimeHelp(action?: ActionManifest, flow = false): string {
  const values: Record<string, string> = {
    input: 'auto|text|lines|jsonl|records',
    output: action?.outputKind === 'records' ? 'records|jsonl' : 'records|jsonl|text|json',
    file: 'PATH',
    profile: 'NAME',
    provider: 'NAME',
    model: 'NAME',
    'force-profile': 'NAME',
    'error-format': 'text|json',
  };
  const flags = [...RUNTIME_FLAGS].filter(
    (flag) =>
      !['args-json', 'version', ...numbers].includes(flag) &&
      (flow || flag !== 'force-profile') &&
      (action?.inputKind !== 'none' || !['file', 'input'].includes(flag)),
  );
  const budgets = [...numbers].map((flag) => {
    const key = flag.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof typeof DEFAULT_BUDGET;
    const normal = DEFAULT_BUDGET[key];
    const exact = key === 'maxBytes' || key === 'maxRecords' ? EXACT_LIMITS[key] : normal;
    const semantic = key === 'maxBytes' || key === 'maxRecords' ? SEMANTIC_LIMITS[key] : normal;
    const defaultValue = exact === semantic ? String(normal) : `exact ${exact}; inference ${semantic}`;

    return `  --${flag} <positive integer> (default: ${defaultValue})`;
  });

  return `Runtime:\n${flags.map((flag) => `  --${flag}${flag === 'help' ? '' : booleans.has(flag) ? '[=true|false]' : ` <${values[flag]}>`}`).join('\n')}\n\nBudgets (milliseconds for *-ms):\n${budgets.join('\n')}`;
}

export function actionHelp(
  name: string,
  manifest: Manifest,
  actionName = 'run',
  overrides: Record<string, unknown> = {},
): string {
  const action = manifest.actions[actionName];
  const defaults = Object.fromEntries(
    Object.entries(action.args.properties ?? {})
      .filter(([, raw]) => Object.hasOwn(raw as JsonSchema, 'default'))
      .map(([field, raw]) => [field, (raw as JsonSchema).default]),
  );

  Object.assign(defaults, overrides);
  const bindings = action.bindings.map((binding) => {
    const property = action.args.properties[binding.field] as JsonSchema;
    const required = (action.args.required ?? []).includes(binding.field) && !Object.hasOwn(defaults, binding.field);
    const details = [required ? 'required' : 'optional'];

    if (Object.hasOwn(defaults, binding.field)) details.push(`default: ${JSON.stringify(defaults[binding.field])}`);
    if (binding.repeated) details.push('repeatable');
    if (binding.positional !== undefined && scalarTypes.has(binding.type))
      details.push(`positional ${binding.positional + 1}`);
    if (!scalarTypes.has(binding.type))
      return `  ${binding.field} <${schemaType(property)}> via --args-json (${details.join('; ')})`;
    const value = schemaType(binding.repeated ? property.items : property);
    const syntax = binding.type === 'boolean' && !binding.repeated ? '[=true|false]' : ` <${value}>`;

    return `  --${binding.flag}${syntax} (${details.join('; ')})`;
  });
  const examples = action.examples.length ? `\n\nExamples:\n${action.examples.map((e) => `  ${e}`).join('\n')}` : '';

  return `ribbit ${name} — ${action.description}\n\nUsage: ribbit ${name} [arguments] [runtime flags]\nType: ${manifest.type}\nAction: ${actionName}\nDefaults: ${JSON.stringify(defaults)}\n\nArguments:\n${bindings.join('\n')}\n  --args-json <object> (typed JSON values keyed by argument field; required for complex/union fields)\n\nBoolean flags use --flag for true or --flag=false for false.\nScalar arrays repeat their flag; --args-json accepts the entire array.\nDo not assign the same field through multiple forms. Use -- before literal positionals starting with --.\n\nInput: ${action.inputKind}; output: ${action.outputKind}.\n${runtimeHelp(action)}${examples}\n`;
}

export function managementHelp(command: string, operation?: string): string {
  const operations = MANAGEMENT[command];
  const selected = operation ? { [operation]: operations[operation] } : operations;

  if (operation && !operations[operation]) throw new RibbitError(2, `Unknown ${command} operation; use --help`);
  const entries = Object.values(selected);
  const flags = [...new Set(entries.flatMap((op) => op.flags))];
  const usage = entries.map((op) => `  ribbit ${command}${op.usage ? ' ' + op.usage : ''} [options]`).join('\n');
  const notes = entries.flatMap((op) => (op.note ? [op.note] : []));

  return `Usage:\n${usage}\n\nOptions:\n${flags.map((flag) => `  --${flag}${managementBooleans.has(flag) ? '[=true|false]' : ` <${MANAGEMENT_FLAGS[flag]}>`}`).join('\n')}\n  --json[=true|false] (default: false)\n  --error-format <text|json> (default: text)\n  --help\n\n${notes.join('\n')}\n`;
}

export function flowHelp(): string {
  return `Usage: ribbit flow run|plan|validate FILE [runtime flags]\n       ribbit flow run|plan|validate [runtime flags] -- COMMAND [args] :: COMMAND [args]\n\nPlan and validate check references without inference. Run executes the flow.\nUse --profile as a flow default, segment --profile to override, or --force-profile to replace all routes.\nInput/output and budget flags must precede -- in inline flows.\n\n${runtimeHelp(undefined, true)}\n`;
}
