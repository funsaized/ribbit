import { expect, test } from 'bun:test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sandbox } from '../../scripts/release/harness.ts';
import { pickerVersion } from '../../src/picker/index.ts';

test('picker version parsing rejects malformed and unsupported versions', () => {
  for (const version of ['0.74.3 (synthetic)', '0.75.0', '1.0.0'])
    expect(pickerVersion(version).status).toBe('supported');
  for (const version of ['0.74.2', '0.73.9']) expect(pickerVersion(version).status).toBe('unsupported');
  for (const version of ['', 'unknown', '0.74', '0.74 (devel)', '0.74.3-rc1', '999999999999999999999.1.1'])
    expect(pickerVersion(version).status).toBe('invalid');
});

for (const mode of ['source', 'compiled'] as const)
  test(`${mode} doctor reports fzf presence, version and failures without launching the picker UI`, async () => {
    const env = await sandbox();
    const bin = join(env.dir, 'bin');
    const empty = join(env.dir, 'empty');
    const marker = join(env.dir, 'picker-calls');

    try {
      await mkdir(bin);
      await mkdir(empty);
      const fake = join(env.dir, 'fzf.ts');

      await writeFile(
        fake,
        `import {appendFileSync} from 'node:fs';
if (process.argv.at(-1) !== '--version') throw new Error('Unexpected picker UI');
appendFileSync(${JSON.stringify(marker)},'version\\n');
const mode=process.env.RIBBIT_FAKE_FZF;
if(mode==='failed') process.exit(1);
if(mode==='timeout') await Bun.sleep(10000);
console.log(mode==='flood'?'x'.repeat(100000):mode);
`,
      );
      const build = Bun.spawn(
        [
          process.execPath,
          'build',
          fake,
          '--compile',
          '--outfile',
          join(bin, process.platform === 'win32' ? 'fzf.exe' : 'fzf'),
        ],
        { stdout: 'ignore', stderr: 'pipe' },
      );
      const err = await new Response(build.stderr).text();

      expect(await build.exited, err).toBe(0);
      const run = async (args: string[], path: string, version = '0.74.3') => {
        const child = Bun.spawn(
          [...(mode === 'source' ? [process.execPath, resolve('src/cli/main.ts')] : [env.binary]), ...args],
          {
            cwd: env.dir,
            env: { ...env.env, PATH: path, RIBBIT_FAKE_FZF: version },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [out, error, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);

        expect(error).toBe('');

        return { code, report: JSON.parse(out) };
      };

      for (const [version, status] of [
        ['0.74.3 (synthetic)', 'supported'],
        ['0.75.0', 'supported'],
        ['0.74.2', 'unsupported'],
        ['unknown', 'invalid'],
        ['0.74 (devel)', 'invalid'],
        ['failed', 'failed'],
        ['flood', 'failed'],
        ['timeout', 'failed'],
      ]) {
        const result = await run(['doctor', '--json', '--', 'pick'], bin, version);

        expect(result.code).toBe(status === 'supported' ? 0 : 3);
        expect(result.report.checks).toContainEqual(
          expect.objectContaining({ name: 'picker', status, minimum: '0.74.3' }),
        );
        expect(result.report.checks).toContainEqual(
          expect.objectContaining({ name: 'route', status: 'not-applicable' }),
        );
      }
      const missing = await run(['doctor', '--json'], empty);

      expect(missing.code).toBe(3);
      expect(missing.report).toMatchObject({ status: 'partial' });
      expect(missing.report.checks).toContainEqual(expect.objectContaining({ name: 'picker', status: 'missing' }));
      expect(missing.report.checks).toContainEqual(
        expect.objectContaining({ name: 'exact-commands', status: 'available' }),
      );
      const before = await readFile(marker, 'utf8');

      expect((await run(['doctor', '--json', '--probe', '--', 'take', '1'], bin, 'failed')).code).toBe(0);
      expect((await run(['route', 'inspect', '--json', '--', 'pick'], bin, 'failed')).report.inference.status).toBe(
        'exact',
      );
      expect(await readFile(marker, 'utf8')).toBe(before);
    } finally {
      await env.close();
    }
  }, 30000);
