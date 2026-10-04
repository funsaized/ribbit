import { version } from '../../package.json';
import { builtins } from '../catalog/index.ts';
import { RibbitError } from '../engine/records/index.ts';
import { ADMIN } from './admin/contract.ts';
import { actionHelp, managementHelp, flowHelp } from './help.ts';

const argv = process.argv.slice(2);

function help(
  name?: string,
  manifest = name ? builtins[name] : undefined,
  actionName = 'run',
  defaults: Record<string, unknown> = {},
) {
  if (name && manifest) {
    console.log(actionHelp(name, manifest, actionName, defaults));

    return;
  }
  if (name === 'flow') {
    console.log(flowHelp());

    return;
  }
  if (name && ADMIN.has(name)) {
    console.log(managementHelp(name, argv[1]?.startsWith('--') ? undefined : argv[1]));

    return;
  }
  console.log(
    `Ribbit — Small commands. Big hops.\n\nUsage: ribbit COMMAND [arguments]\n\nCommands:\n  ${Object.keys(builtins).join(', ')}\n\nManagement:\n  ${[...ADMIN].join(', ')}, run, flow\n\nUse ribbit COMMAND --help or ribbit types describe @ribbit/COMMAND --json.`,
  );
}

async function main() {
  if (argv.length === 1 && argv[0] === '--version') {
    console.log(`ribbit ${version}`);

    return;
  }
  if (!argv.length || argv[0] === '--help') {
    help();

    return;
  }
  if (argv.slice(0, argv.indexOf('--') < 0 ? undefined : argv.indexOf('--')).includes('--help')) {
    if (argv[0] === 'run' && (!argv[1] || argv[1].startsWith('--'))) {
      console.log(
        'Usage: ribbit run COMMAND [arguments] [runtime flags]\nUse ribbit run COMMAND --help for its contract.',
      );

      return;
    }
    const name = argv[0] === 'run' ? argv[1] : argv[0];

    if (name && (argv[0] === 'run' || (!builtins[name] && !ADMIN.has(name) && name !== 'flow'))) {
      const invocation = await (await import('../definitions/index.ts')).resolveInvocation(name);

      help(argv[0] === 'run' ? `run ${name}` : name, invocation.manifest, invocation.action, invocation.args);
    } else help(name);

    return;
  }
  const command = argv[0];

  // Invocation inspection handles target help before loading credential configuration.
  if (!['route', 'doctor'].includes(command)) (await import('../config/index.ts')).loadDotenv();

  if (ADMIN.has(command)) {
    await (await import('./admin/index.ts')).admin(command, argv.slice(1));

    return;
  }
  if (command === 'flow') {
    await (await import('../flows/cli.ts')).flowCli(argv.slice(1));

    return;
  }
  const { prepareInvocation } = await import('./invocation.ts');
  const prepared = await prepareInvocation(argv);

  if ('help' in prepared) {
    console.log(prepared.help);

    return;
  }
  const { invocation, runtime, action, semantic, limits, cli } = prepared;
  const { runInvocation } = await import('../engine/runtime/index.ts');
  const { Budget } = await import('../engine/execution/index.ts');
  const budget = new Budget(limits);
  const cancel = () => budget.controller.abort(new RibbitError(130, 'Cancelled'));

  process.once('SIGINT', cancel);
  try {
    const { loadConfig } = await import('../config/index.ts');
    const config = await loadConfig();
    const io = await import('./io/index.ts');
    const input = await io.readInput(
      runtime,
      action,
      invocation.args,
      semantic,
      invocation.name === 'take' && invocation.args.count === 0,
    );
    const result = await runInvocation(invocation, input, budget, config, { cli });

    await io.write(io.output(result, runtime, invocation.name));
  } finally {
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
    process.removeListener('SIGINT', cancel);
    budget.close();
  }
}

try {
  await main();
} catch (error) {
  const code = error instanceof RibbitError ? error.code : 2;
  const message = error instanceof RibbitError ? error.message : 'Invalid input or configuration';
  const location = error instanceof RibbitError ? error.location : undefined;
  const json = argv.some(
    (arg, i) => arg === '--error-format=json' || (arg === '--error-format' && argv[i + 1] === 'json'),
  );

  console.error(
    json
      ? JSON.stringify({ schemaVersion: 1, error: { code, message, ...(location ? { location } : {}) } })
      : `ribbit: ${message}${location ? ` (${location})` : ''}`,
  );
  process.exitCode = code;
}
