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
      `import {appendFileSync} from 'node:fs';import {defineCommand,defineAction,z} from '@ribbit/sdk';appendFileSync(${JSON.stringify(marker)},'import\\n');const config=z.strictObject({});export default defineCommand({type:'@audit/echo',version:'1.0.0',description:'audit',config,actions:{run:defineAction({config,args:config,input:z.string(),output:z.string(),mode:'value',description:'echo',inputKind:'text',outputKind:'text',capabilities:[],effects:[],execute:({input})=>input})}});`,
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
      ['route', 'inspect', 'echo', '--json'],
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
