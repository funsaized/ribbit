import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { addExtension } from '../../src/extensions/build/index.ts';
import { ADMIN } from '../../src/cli/admin/contract.ts';

const names = ['echo', ...ADMIN, 'run', 'flow'];

describe('dormant extension discovery', () => {
  let fixture: Awaited<ReturnType<typeof discoverySandbox>>;

  // These contracts only inspect immutable files; compile their extension once, not once per CLI case.
  beforeAll(async () => {
    fixture = await discoverySandbox();
  }, 30000);
  afterAll(async () => {
    await fixture?.close();
  });

  const cases: [string, string[][]][] = [
    [
      'catalog and management help',
      [
        ['--help'],
        ['echo', '--help'],
        ['providers', 'add', '--help'],
        ['models', 'list', '--help'],
        ['doctor', '--help'],
        ['extensions', 'add', '--help'],
        ['types', 'describe', '@audit/echo', '--json'],
        ['types', 'list', '--json'],
        ['commands', 'describe', 'echo', '--json'],
      ],
    ],
    ['named help including reserved names', names.map((name) => ['run', name, '--help'])],
    [
      'invocation inspection',
      [
        ['route', 'inspect', '--json', '--', 'echo'],
        ['route', 'inspect', '--json', '--', 'semantic-echo'],
        ['route', 'inspect', '--json', '--', 'echo', '--semantic'],
        ['route', 'inspect', '--', 'echo', '--help'],
        ['doctor', '--json', '--', 'semantic-echo'],
        ['doctor', '--json', '--', 'echo', '--semantic=false'],
        ['doctor', '--probe', '--', 'echo', '--help'],
        ['doctor', '--probe=false', '--json'],
      ],
    ],
    ['reserved-name route inspection', names.map((name) => ['route', 'inspect', '--json', '--', 'run', name])],
    [
      'flow planning and completions',
      [
        ['flow', 'plan', '--', 'semantic-echo'],
        ['flow', 'plan', 'flow.yaml'],
        ...['bash', 'zsh', 'fish'].map((shell) => ['completions', shell]),
      ],
    ],
  ];

  for (const [contract, commands] of cases) {
    test(`${contract} does not import installed code or invoke fetch`, async () => {
      for (const args of commands) {
        const { out, err, code } = await fixture.run(args);

        expect({ args, code, err }).toEqual({ args, code: 0, err: '' });
        expect(out.length).toBeGreaterThan(0);
        expect(await readFile(fixture.marker, 'utf8')).toBe(fixture.initial);
      }
    }, 30000);
  }
});

test('execution imports only the selected extension and scoped doctor detects stale sources', async () => {
  const fixture = await discoverySandbox();

  try {
    const run = await fixture.run(['echo'], 'offline');

    expect(run.out).toBe('offline\n');
    expect(run.code).toBe(0);
    expect(await readFile(fixture.marker, 'utf8')).toBe(fixture.initial + 'import\n');
    await writeFile(
      join(fixture.source, 'index.ts'),
      (await readFile(join(fixture.source, 'index.ts'), 'utf8')) + '\n// Stale synthetic source\n',
    );
    for (const [target, expectedCode] of [
      [['semantic-echo'], 3],
      [['take', '1'], 0],
    ] as const) {
      const child = await fixture.run(['doctor', '--json', '--', ...target]);
      const report = JSON.parse(child.out);

      expect(child.err).toBe('');
      expect(child.code).toBe(expectedCode);
      if (expectedCode === 3)
        expect(report.checks).toContainEqual(
          expect.objectContaining({ name: 'extension:@audit/echo', status: 'stale' }),
        );
      expect(await readFile(fixture.marker, 'utf8')).toBe(fixture.initial + 'import\n');
    }
  } finally {
    await fixture.close();
  }
}, 30000);

async function discoverySandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-discovery-')),
    source = join(dir, 'source'),
    marker = join(dir, 'imports'),
    guard = join(dir, 'guard.ts'),
    data = join(dir, 'data');

  try {
    await mkdir(source);
    await writeFile(
      join(source, 'index.ts'),
      `import {appendFileSync} from 'node:fs';import {defineCommand,defineAction,z} from '@ribbit/sdk';appendFileSync(${JSON.stringify(marker)},'import\\n');const config=z.strictObject({});export default defineCommand({type:'@audit/echo',version:'1.0.0',description:'audit',config,actions:{run:defineAction({config,args:z.strictObject({semantic:z.boolean().default(false)}),input:z.string(),output:z.string(),mode:'value',description:'echo',inputKind:'text',outputKind:'text',capabilities:{whenAny:['semantic'],ifTrue:['text'],ifFalse:[]},effects:[],execute:({input})=>input})}});`,
    );
    await addExtension(source, join(data, 'ribbit', 'extensions'));
    const initial = await readFile(marker, 'utf8');

    await mkdir(join(dir, 'commands'));
    for (const name of names)
      await writeFile(
        join(dir, 'commands', `${name}.yaml`),
        `apiVersion: ribbit/v1\nkind: Command\nname: ${name}\ntype: '@audit/echo'\ntypeVersion: '1.0.0'\naction: run\n`,
      );
    await writeFile(
      join(dir, 'flow.yaml'),
      'apiVersion: ribbit/v1\nkind: Flow\nname: audit\nsteps:\n  - id: first\n    command: echo\n',
    );
    await mkdir(join(dir, 'config', 'ribbit'), { recursive: true });
    await writeFile(
      join(dir, 'config', 'ribbit', 'config.yaml'),
      JSON.stringify({
        providers: {
          synthetic: {
            type: 'ollama',
            baseUrl: 'http://127.0.0.1:1',
            defaultModel: 'synthetic',
            capabilities: ['text'],
          },
        },
        default: { provider: 'synthetic' },
      }),
    );
    await writeFile(
      join(dir, 'commands', 'semantic-echo.yaml'),
      "apiVersion: ribbit/v1\nkind: Command\nname: semantic-echo\ntype: '@audit/echo'\ntypeVersion: '1.0.0'\naction: run\ndefaults: {semantic: true}\n",
    );
    await writeFile(guard, "globalThis.fetch=(()=>{throw new Error('NETWORK FORBIDDEN');}) as typeof fetch;");

    return {
      source,
      marker,
      initial,
      async run(args: string[], input?: string) {
        const child = Bun.spawn(['bun', '--preload', guard, resolve('src/cli/main.ts'), ...args], {
          cwd: dir,
          env: { ...process.env, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: data },
          stdin: input === undefined ? 'ignore' : new Blob([input]),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [out, err, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);

        return { out, err, code };
      },
      close: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
