import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { addExtension } from '../../src/extensions/build/index.ts';
import { ADMIN } from '../../src/cli/admin/contract.ts';

test('catalog/help/completions/plan do not import installed code or invoke fetch', async () => {
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
    const names = ['echo', ...ADMIN, 'run', 'flow'];

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
    for (const args of [
      ['--help'],
      ['echo', '--help'],
      ...names.map((name) => ['run', name, '--help']),
      ['providers', 'add', '--help'],
      ['models', 'list', '--help'],
      ['doctor', '--help'],
      ['extensions', 'add', '--help'],
      ['types', 'describe', '@audit/echo', '--json'],
      ['types', 'list', '--json'],
      ['commands', 'describe', 'echo', '--json'],
      ['route', 'inspect', '--json', '--', 'echo'],
      ['route', 'inspect', '--json', '--', 'semantic-echo'],
      ['route', 'inspect', '--json', '--', 'echo', '--semantic'],
      ['route', 'inspect', '--', 'echo', '--help'],
      ['doctor', '--json', '--', 'semantic-echo'],
      ['doctor', '--json', '--', 'echo', '--semantic=false'],
      ['doctor', '--probe', '--', 'echo', '--help'],
      ...names.map((name) => ['route', 'inspect', '--json', '--', 'run', name]),
      ['flow', 'plan', '--', 'semantic-echo'],
      ['doctor', '--probe=false', '--json'],
      ['flow', 'plan', 'flow.yaml'],
      ...['bash', 'zsh', 'fish'].map((s) => ['completions', s]),
    ]) {
      const p = Bun.spawn(['bun', '--preload', guard, resolve('src/cli/main.ts'), ...args], {
        cwd: dir,
        env: { ...process.env, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: data },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [out, err, code] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
        p.exited,
      ]);

      expect({ args, code, err }).toEqual({ args, code: 0, err: '' });
      expect(out.length).toBeGreaterThan(0);
      expect(await readFile(marker, 'utf8')).toBe(initial);
    }
    const run = Bun.spawn(['bun', '--preload', guard, resolve('src/cli/main.ts'), 'echo'], {
      cwd: dir,
      env: { ...process.env, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: data },
      stdin: new Blob(['offline']),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(await new Response(run.stdout).text()).toBe('offline\n');
    expect(await run.exited).toBe(0);
    expect(await readFile(marker, 'utf8')).toBe(initial + 'import\n');
    await writeFile(
      join(source, 'index.ts'),
      (await readFile(join(source, 'index.ts'), 'utf8')) + '\n// Stale synthetic source\n',
    );
    for (const [target, expectedCode] of [
      [['semantic-echo'], 3],
      [['take', '1'], 0],
    ] as const) {
      const child = Bun.spawn(
        ['bun', '--preload', guard, resolve('src/cli/main.ts'), 'doctor', '--json', '--', ...target],
        {
          cwd: dir,
          env: { ...process.env, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: data },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const report = JSON.parse(await new Response(child.stdout).text());

      expect(await new Response(child.stderr).text()).toBe('');
      expect(await child.exited).toBe(expectedCode);
      if (expectedCode === 3)
        expect(report.checks).toContainEqual(
          expect.objectContaining({ name: 'extension:@audit/echo', status: 'stale' }),
        );
      expect(await readFile(marker, 'utf8')).toBe(initial + 'import\n');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
