export interface ManagementOperation {
  usage: string;
  flags: string[];
  note?: string;
}

export const MANAGEMENT: Record<string, Record<string, ManagementOperation>> = {
  providers: {
    list: { usage: 'list', flags: [] },
    add: {
      usage: 'add NAME --type TYPE --base-url URL',
      flags: ['type', 'base-url', 'default-model', 'api-key-env', 'capabilities'],
      note: 'NAME is a lowercase identifier. Required: --type (ollama|openai-compatible), --base-url. --capabilities accepts comma-separated text, stream, object, temperature, maxOutputTokens, reasoning; default: text. Saves endpoint configuration; does not contact the provider.',
    },
    remove: { usage: 'remove NAME', flags: [], note: 'Referenced providers cannot be removed.' },
  },
  profiles: {
    list: { usage: 'list', flags: [] },
    show: { usage: 'show NAME', flags: [] },
    set: {
      usage: 'set NAME --provider NAME --model NAME',
      flags: ['provider', 'model', 'temperature', 'max-output-tokens', 'timeout'],
      note: 'Required: --provider (already configured), --model. Saves settings without inference.',
    },
    remove: { usage: 'remove NAME', flags: [], note: 'Referenced profiles cannot be removed.' },
  },
  models: {
    list: {
      usage: 'list --provider NAME',
      flags: ['provider'],
      note: 'Required: --provider. Contacts that provider to list installed models; does not download models.',
    },
  },
  route: {
    inspect: {
      usage: 'inspect [options] -- COMMAND [arguments] [runtime flags]',
      flags: [],
      note: 'Parses a concrete invocation using execution defaults and overrides, without reading input or contacting providers. Put --json before -- and target --profile/--provider/--model after it. COMMAND may be run NAME. Exact invocations need no inference route. Use flow plan for unresolved flow references.',
    },
  },
  commands: {
    list: { usage: 'list', flags: [] },
    describe: { usage: 'describe NAME', flags: [] },
    validate: { usage: 'validate NAME', flags: [], note: 'Validates a named definition without importing its code.' },
  },
  types: {
    list: { usage: 'list', flags: [] },
    describe: { usage: 'describe SCOPED_TYPE', flags: [], note: 'Use a scoped ID such as @ribbit/take.' },
  },
  extensions: {
    list: { usage: 'list', flags: [] },
    scaffold: { usage: 'scaffold PATH [--type SCOPED_TYPE]', flags: ['type'] },
    check: { usage: 'check PATH', flags: [], note: 'Executes trusted extension code to check its contract.' },
    test: { usage: 'test PATH', flags: [], note: 'Executes trusted extension code against its fixtures.' },
    add: { usage: 'add PATH', flags: [], note: 'Executes and installs trusted extension code; not a sandbox.' },
    remove: { usage: 'remove SCOPED_TYPE', flags: [], note: 'Preserves the extension source directory.' },
  },
  init: {
    '': {
      usage: '[--agent codex|claude|cursor|opencode]',
      flags: ['agent'],
      note: 'Creates .ribbit.yaml if missing; optionally appends agent guidance without replacing existing content.',
    },
  },
  completions: {
    bash: { usage: 'bash', flags: [] },
    zsh: { usage: 'zsh', flags: [] },
    fish: { usage: 'fish', flags: [] },
  },
  setup: {
    '': {
      usage: '',
      flags: [],
      note: 'Probes local Ollama and LM Studio endpoints. Does not download models or change configuration.',
    },
  },
  doctor: {
    '': {
      usage: '[options] [-- COMMAND [arguments] [runtime flags]]',
      flags: ['probe'],
      note: 'Checks configuration, route completeness, declared capabilities, authentication readiness, fzf >=0.74.3 and extension freshness. Optional -- COMMAND scopes readiness to that invocation. Exit 0 means applicable checks passed, not proven model quality; exit 3 means partial/unavailable readiness. Only --probe or --probe=true lists models (selected provider when scoped, all configured providers otherwise); --probe=false stays offline. No inference, downloads or configuration changes.',
    },
  },
};

export const ADMIN = new Set(Object.keys(MANAGEMENT));

export const MANAGEMENT_FLAGS: Record<string, string> = {
  type: 'TYPE',
  'base-url': 'URL',
  'default-model': 'NAME',
  'api-key-env': 'ENV_NAME',
  capabilities: 'CAPABILITY[,CAPABILITY...]',
  provider: 'NAME',
  model: 'NAME',
  profile: 'NAME',
  temperature: 'NUMBER',
  'max-output-tokens': 'POSITIVE_INTEGER',
  timeout: 'POSITIVE_MILLISECONDS',
  agent: 'codex|claude|cursor|opencode',
  'error-format': 'text|json',
};

export const managementBooleans = new Set(['json', 'probe']);
