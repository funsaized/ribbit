import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('failed configuration update preserves prior bytes and route inspection hides secret values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-management-'));
  const env = { ...process.env, XDG_CONFIG_HOME: dir, RIBBIT_TEST_KEY: 'NEVER-PRINT-THIS' };

  async function run(args: string[]) {
    const p = Bun.spawn(['bun', resolve('src/cli/main.ts'), ...args], {
      cwd: dir,
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return { out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text(), code: await p.exited };
  }

  try {
    expect(
      (
        await run([
          'providers',
          'add',
          'local',
          '--type',
          'openai-compatible',
          '--base-url',
          'http://127.0.0.1:1/v1',
          '--default-model',
          'test',
          '--api-key-env',
          'RIBBIT_TEST_KEY',
        ])
      ).code,
    ).toBe(0);
    const path = join(dir, 'ribbit', 'config.yaml'),
      before = await readFile(path, 'utf8');
    const invalid = await run([
      'profiles',
      'set',
      'bad',
      '--provider',
      'local',
      '--model',
      'test',
      '--max-output-tokens',
      '-1',
    ]);

    expect(invalid.code).not.toBe(0);
    expect(await readFile(path, 'utf8')).toBe(before);
    const inspect = await run(['route', 'inspect', '--json', '--', 'ask', 'Synthetic question', '--provider', 'local']);

    expect(inspect.code).toBe(0);
    expect(inspect.out + inspect.err).not.toContain('NEVER-PRINT-THIS');
    expect(inspect.out).not.toContain('RIBBIT_TEST_KEY');
    await writeFile(path, 'broken: [');
    expect(
      (await run(['providers', 'add', 'new', '--type', 'ollama', '--base-url', 'http://127.0.0.1:11434'])).code,
    ).toBe(3);
    expect(await readFile(path, 'utf8')).toBe('broken: [');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
