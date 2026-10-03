import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { builtins } from '../../src/catalog/index.ts';
import { parseAction, numbers, scalarTypes } from '../../src/cli/parser/index.ts';
import { options } from '../../src/cli/admin/index.ts';
import { ADMIN, MANAGEMENT, managementBooleans } from '../../src/cli/admin/contract.ts';
import { actionHelp, managementHelp, runtimeHelp } from '../../src/cli/help.ts';
import { cases, pickerCase } from '../../scripts/release/cases.ts';
import { z, defineCommand, defineAction } from '../../src/sdk/index.ts';
import { manifest, hash, type JsonSchema } from '../../src/sdk/manifest/index.ts';

test('every advertised builtin binding parses using its actual schema and defaults', () => {
  const fixtures = [...cases(), pickerCase, { command: 'where', args: ['ok', '--args-json', '{"equals":false}'] }];

  for (const [name, command] of Object.entries(builtins)) {
    const action = command.actions.run;
    const fixture = fixtures.find((c) => c.command === name)!;
    const baseline = parseAction(fixture.args, action).args;
    const help = actionHelp(name, command);
    const defaults = JSON.parse(help.match(/^Defaults: (.+)$/m)![1]) as Record<string, unknown>;

    const withoutDefaults = { ...baseline };

    for (const field of Object.keys(defaults)) delete withoutDefaults[field];
    const defaulted = parseAction(['--args-json', JSON.stringify(withoutDefaults)], action).args;

    for (const [field, value] of Object.entries(defaults)) expect(defaulted[field]).toEqual(value);
    for (const binding of action.bindings) {
      const property = action.args.properties[binding.field] as JsonSchema;
      const schema = binding.repeated ? property.items : property;
      const sample =
        schema.enum?.[0] ??
        schema.const ??
        (binding.type === 'boolean' ? false : ['number', 'integer'].includes(binding.type) ? 1 : 'sample');
      const base = { ...baseline };

      delete base[binding.field];
      if (!scalarTypes.has(binding.type)) {
        expect(help).toContain(`${binding.field} <`);
        expect(help).not.toContain(`--${binding.flag} <`);
        expect(parseAction(['--args-json', JSON.stringify(baseline)], action).args).toEqual(baseline);
        continue;
      }
      expect(help).toContain(`--${binding.flag}`);
      const count = binding.repeated ? Math.max(property.minItems ?? 1, 2) : 1;
      const tokens = Array.from({ length: count }, () =>
        binding.type === 'boolean' && !binding.repeated
          ? [`--${binding.flag}=${sample}`]
          : [`--${binding.flag}`, String(sample)],
      ).flat();
      const parsed = parseAction(['--args-json', JSON.stringify(base), ...tokens], action);

      expect(parsed.args[binding.field]).toEqual(binding.repeated ? Array(count).fill(sample) : sample);
    }
    for (const flag of numbers) {
      expect(help).toContain(`--${flag} <positive integer>`);
      expect(parseAction([...fixture.args, `--${flag}`, '1000'], action).runtime[flag]).toBe(1000);
    }
  }
  expect(actionHelp('where', builtins.where)).toContain(
    'equals <string|number|boolean|null> via --args-json (required)',
  );
  expect(actionHelp('render', builtins.render)).toContain(
    '--as <"text"|"table"|"json"|"jsonl"> (optional; default: "text")',
  );
  expect(actionHelp('take', builtins.take)).toContain('--count <integer> (required; positional 1)');
  expect(actionHelp('ls', builtins.ls)).not.toContain('--file <');
  expect(runtimeHelp(builtins.take.actions.run)).not.toContain('--force-profile');
  expect(runtimeHelp(undefined, true)).toContain('--force-profile <NAME>');
});

test('extension help handles nested/nullable fields, repeated enums/booleans and named defaults without coercion', () => {
  const config = z.strictObject({});
  const command = manifest(
    defineCommand({
      type: '@test/help',
      version: '1.0.0',
      description: 'help',
      config,
      actions: {
        run: defineAction({
          config,
          description: 'help',
          args: z.strictObject({
            prompt: z.string(),
            enabled: z.boolean().default(true),
            disabled: z.literal(false).default(false),
            locked: z.literal(true).default(true),
            label: z.array(z.enum(['yes', 'no'])),
            bit: z.array(z.boolean()).optional(),
            nested: z.strictObject({ value: z.string() }).optional(),
            nullable: z.union([z.string(), z.null()]).optional(),
          }),
          input: z.string(),
          output: z.string(),
          mode: 'value',
          capabilities: [],
          effects: [],
          cli: { positionals: ['prompt'] },
          execute: ({ input }) => input,
        }),
      },
    }),
    hash('help'),
  );
  const help = actionHelp('named', command, 'run', { prompt: 'saved', enabled: false });
  const action = command.actions.run;

  expect(help).toContain('--prompt <string> (optional; default: "saved"; positional 1)');
  expect(help).toContain('--enabled[=true|false] (optional; default: false)');
  expect(help).toContain('--disabled=false (optional; default: false)');
  expect(help).toContain('--locked[=true] (optional; default: true)');
  expect(parseAction(['saved', '--label', 'yes', '--disabled=false', '--locked'], action).args.disabled).toBe(false);
  expect(() => parseAction(['saved', '--label', 'yes', '--disabled'], action)).toThrow();
  expect(() => parseAction(['saved', '--label', 'yes', '--locked=false'], action)).toThrow();
  expect(help).toContain('--label <"yes"|"no"> (required; repeatable)');
  expect(help).toContain('--bit <boolean> (optional; repeatable)');
  expect(help).toContain('nested <object> via --args-json');
  expect(help).toContain('nullable <string|null> via --args-json');
  expect(help).not.toContain('--nested <');
  expect(help).not.toContain('--nullable <');
  expect(
    parseAction(
      [
        '--enabled=false',
        '--label',
        'yes',
        '--label',
        'no',
        '--bit',
        'false',
        '--bit',
        'true',
        '--args-json',
        '{"nested":{"value":"ok"},"nullable":null}',
        '--stats=false',
      ],
      action,
      { prompt: 'saved' },
    ),
  ).toEqual({
    args: {
      prompt: 'saved',
      enabled: false,
      disabled: false,
      locked: true,
      label: ['yes', 'no'],
      bit: [false, true],
      nested: { value: 'ok' },
      nullable: null,
    },
    runtime: { stats: false },
  });
  for (const [values, syntax] of [
    [[false], '=false'],
    [[true], '[=true]'],
    [[true, false], '[=true|false]'],
  ] as const) {
    const restricted = {
      ...command,
      actions: {
        run: {
          ...action,
          args: {
            ...action.args,
            properties: { ...action.args.properties, enabled: { type: 'boolean', enum: values } },
          },
        },
      },
    };

    expect(actionHelp('named', restricted)).toContain(`--enabled${syntax} (required)`);
    for (const value of [true, false]) {
      const parse = () => parseAction(['saved', '--label', 'yes', `--enabled=${value}`], restricted.actions.run);

      if (values.some((allowed) => allowed === value)) expect(parse().args.enabled).toBe(value);
      else expect(parse).toThrow();
    }
  }
});

test('help suppresses positional slots blocked by complex or repeated arguments', () => {
  const config = z.strictObject({});

  for (const middle of [z.strictObject({ value: z.string() }), z.array(z.string())]) {
    const command = manifest(
      defineCommand({
        type: '@test/positionals',
        version: '1.0.0',
        description: 'positionals',
        config,
        actions: {
          run: defineAction({
            config,
            description: 'positionals',
            args: z.strictObject({ first: z.string(), middle, last: z.string() }),
            input: z.string(),
            output: z.string(),
            mode: 'value',
            capabilities: [],
            effects: [],
            cli: { positionals: ['first', 'middle', 'last'] },
            execute: ({ input }) => input,
          }),
        },
      }),
      hash('positionals'),
    );
    const help = actionHelp('positionals', command);
    const action = command.actions.run;
    const value = middle instanceof z.ZodArray ? ['one', 'two'] : { value: 'saved' };
    const json = JSON.stringify({ middle: value });

    expect(help).toContain('--first <string> (required; positional 1)');
    expect(help).toContain('--last <string> (required)');
    expect(help).not.toContain('positional 3');
    expect(parseAction(['first', '--args-json', json, '--last', 'last'], action).args).toEqual({
      first: 'first',
      middle: value,
      last: 'last',
    });
    expect(() => parseAction(['first', '--args-json', json, 'last'], action)).toThrow();
    expect(
      parseAction(['--args-json', JSON.stringify({ first: 'first', middle: value, last: 'last' })], action).args.last,
    ).toBe('last');
    if (middle instanceof z.ZodArray) {
      expect(help).toContain('--middle <string> (required; repeatable; positional 2)');
      expect(parseAction(['first', 'one', 'two', '--last', 'last'], action).args.middle).toEqual(value);
    } else expect(help).not.toContain('positional 2');
  }
});

test('management help and flag parsing share contracts, including explicit false', () => {
  for (const [command, operations] of Object.entries(MANAGEMENT)) {
    for (const [operation, contract] of Object.entries(operations)) {
      const help = managementHelp(command, operation || undefined);

      expect(help).toContain(`ribbit ${command}${contract.usage ? ' ' + contract.usage : ''}`);
      for (const flag of [...contract.flags, 'json', 'error-format']) {
        expect(help).toContain(`--${flag}`);
        const boolean = managementBooleans.has(flag);
        const tokens = boolean ? [`--${flag}=false`] : [`--${flag}`, 'sample'];

        expect(options(tokens, contract.flags).flags[flag]).toBe(boolean ? false : 'sample');
      }
    }
  }
  expect(managementHelp('providers', 'add')).toContain('ollama|openai-compatible');
  expect(managementHelp('providers', 'add')).toContain('Required: --type');
  expect(() => options(['--probe=invalid'], ['probe'])).toThrow('expects true or false');
  expect(() => options(['--json=false', '--json'], [])).toThrow('Duplicate management flag');
});

test('help examples and typed/boolean invocations run offline in an isolated directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-help-'));
  const guard = join(dir, 'guard.ts');
  const entry = resolve('src/cli/main.ts');
  const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data') };
  const prefix = ['bun', '--preload', guard, entry];
  const run = async (args: string[], input = '') => {
    const p = Bun.spawn([...prefix, ...args], {
      cwd: dir,
      env,
      stdin: new Blob([input]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);

    return { out, err, code };
  };

  try {
    await writeFile(guard, "globalThis.fetch=(()=>{throw new Error('NETWORK FORBIDDEN');}) as typeof fetch;");
    for (const [command, operations] of Object.entries(MANAGEMENT)) {
      for (const operation of Object.keys(operations)) {
        const result = await run([command, ...(operation ? [operation] : []), '--help']);

        expect(result.code, `${command} ${operation}: ${result.err}`).toBe(0);
        expect(result.out).toContain(`ribbit ${command}`);
      }
    }
    for (const [command, m] of Object.entries(builtins)) {
      expect((await run([command, '--help'])).code).toBe(0);
      for (const example of m.actions.run.examples) {
        if (example === `ribbit ${command} --help`) continue;
        if (process.platform === 'win32') continue; // This example uses POSIX shell quoting and printf.
        const script = example.replace('ribbit ', prefix.map((s) => `'${s.replaceAll("'", "'\\''")}'`).join(' ') + ' ');
        const p = Bun.spawn(['bash', '-o', 'pipefail', '-c', script], {
          cwd: dir,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [out, err, code] = await Promise.all([
          new Response(p.stdout).text(),
          new Response(p.stderr).text(),
          p.exited,
        ]);

        expect(code, err).toBe(0);
        expect(out).toBe('{"ok":true}\n');
      }
    }
    expect(
      await run(
        ['where', 'ok', '--args-json', '{"equals":false}', '--input', 'jsonl', '--output', 'jsonl'],
        '{"ok":true}\n{"ok":false}\n',
      ),
    ).toEqual({ code: 0, err: '', out: '{"ok":false}\n' });
    expect(
      await run(
        [
          'sort',
          '--by',
          'n',
          '--type',
          'number',
          '--descending=false',
          '--stats=false',
          '--input',
          'jsonl',
          '--output',
          'jsonl',
        ],
        '{"n":2}\n{"n":1}\n',
      ),
    ).toEqual({ code: 0, err: '', out: '{"n":1}\n{"n":2}\n' });
    await mkdir(join(dir, 'commands'));
    await writeFile(
      join(dir, 'commands', 'brief.yaml'),
      "apiVersion: ribbit/v1\nkind: Command\nname: brief\ntype: '@ribbit/summarize'\ntypeVersion: '1.0.0'\naction: run\ndefaults: {words: 12}\n",
    );
    expect((await run(['run', 'brief', '--help'])).out).toContain('Defaults: {"rule":[],"words":12}');
    expect((await run(['run', '--help'])).out).toContain('Usage: ribbit run COMMAND');
    for (const name of [...ADMIN, 'run', 'flow']) {
      await writeFile(
        join(dir, 'commands', `${name}.yaml`),
        `apiVersion: ribbit/v1\nkind: Command\nname: ${name}\ntype: '@ribbit/take'\ntypeVersion: '1.0.0'\naction: run\ndefaults: {count: 1}\n`,
      );
      const help = await run(['run', name, '--help']);

      expect(help.code, `${name}: ${help.err}`).toBe(0);
      expect(help.out).toContain(`Usage: ribbit run ${name} [arguments]`);
      expect(help.out).toContain('Type: @ribbit/take');
      expect(help.out).toContain('Defaults: {"count":1}');
      expect((await run(['commands', 'validate', name, '--json'])).code).toBe(0);
      expect(await run(['run', name, '--input', 'lines', '--output', 'jsonl'], 'first\nsecond\n')).toEqual({
        code: 0,
        err: '',
        out: '"first"\n',
      });
      expect((await run([name, '--help'])).out).not.toContain('Type: @ribbit/take');
    }
    const completions = await run(['completions', 'bash']);

    expect(completions.code).toBe(0);
    expect(completions.out).not.toContain('--equals');
    expect(completions.out).toContain('--args-json');
    expect(completions.out).toContain('--base-url');
    expect((await run(['providers', 'list', '--json=false'])).out).not.toContain('schemaVersion');
    expect((await run(['providers', 'list', '--default-model', 'ignored'])).code).toBe(2);
    expect(
      (
        await run([
          'providers',
          'add',
          'local',
          '--type',
          'ollama',
          '--base-url',
          'http://127.0.0.1:1',
          '--default-model',
          'sample',
          '--api-key-env',
          'HELP_TEST_KEY',
          '--capabilities',
          'text,stream',
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await run([
          'profiles',
          'set',
          'local',
          '--provider',
          'local',
          '--model',
          'sample',
          '--temperature',
          '0',
          '--max-output-tokens',
          '10',
          '--timeout',
          '1000',
        ])
      ).code,
    ).toBe(0);
    const doctor = await run(['doctor', '--probe=false', '--json']);

    expect(doctor.err).toBe('');
    expect(JSON.parse(doctor.out).checks.map((c: { name: string }) => c.name)).not.toContain('local');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
