import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const source = resolve('examples/extensions/gh-evidence');
const cli = resolve('src/cli/main.ts');
const sha = 'a'.repeat(40);
const url = 'https://github.com/sample/project/pull/7';
const pull = {
  id: 18,
  number: 7,
  html_url: url,
  title: 'Fix CI',
  body: 'Failed test',
  user: { login: 'dev' },
  head: { sha },
};
const comment = { id: 19, html_url: `${url}#issuecomment-19`, body: 'Reproduce this', user: { login: 'reviewer' } };

test('cloneable check and default fixtures cannot invoke gh', async () => {
  const { dir, cloned, env } = await offlineSandbox();
  const call = (args: string[]) => run(dir, env, args);

  try {
    expect((await call(['extensions', 'check', cloned, '--json'])).code).toBe(0);
    const fixtures = await call(['extensions', 'test', cloned, '--json']);

    expect(fixtures.code).toBe(0);
    expect(JSON.parse(fixtures.out)).toMatchObject({ passed: 7, failed: 0 });
    await expect(readFile(join(dir, 'log'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);

test('installed lifecycle rejects invalid arguments and stale sources without invoking gh', async () => {
  const { dir, cloned, env } = await offlineSandbox();
  const call = (args: string[]) => run(dir, env, args);

  try {
    expect((await call(['extensions', 'add', cloned, '--json'])).code).toBe(0);
    expect((await call(['gh-evidence', '--help'])).out).toContain('Action: run');
    expect((await call(['commands', 'describe', 'gh-evidence', '--json'])).out).toContain('@examples/gh-evidence');
    expect((await call(['gh-evidence', '--repository', 'oops;', '--number', '7'])).code).toBe(2);
    await expect(readFile(join(dir, 'log'))).rejects.toMatchObject({ code: 'ENOENT' });
    await appendFile(join(cloned, 'index.ts'), '\n');
    expect((await call(['gh-evidence', '--repository', 'sample/project', '--number', '7'])).code).toBe(3);
    expect((await call(['extensions', 'add', cloned, '--json'])).code).toBe(0);
    expect((await call(['gh-evidence', '--repository', 'oops;', '--number', '7'])).code).toBe(2);
    await expect(readFile(join(dir, 'log'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await call(['extensions', 'remove', '@examples/gh-evidence', '--json'])).code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);

test.skipIf(process.platform === 'win32')(
  'acquisition uses only fixed GET paths, bounded pages, and redacted errors',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ribbit-gh-run-'));

    try {
      await mkdir(join(dir, 'bin'));
      await mkdir(join(dir, 'commands'));
      await writeFile(
        join(dir, 'commands', 'gh-evidence.yaml'),
        await readFile(resolve('examples/commands/gh-evidence.yaml'), 'utf8'),
      );
      const env = {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
        GH_LOG: join(dir, 'log'),
        XDG_CONFIG_HOME: join(dir, 'config'),
        XDG_DATA_HOME: join(dir, 'data'),
      };

      expect((await run(dir, env, ['extensions', 'add', source])).code).toBe(0);
      const page = Array.from({ length: 50 }, (_, i) => ({ ...comment, id: i + 100 }));
      const responses: Record<string, unknown> = {
        'repos/sample/project/pulls/7': pull,
        'repos/sample/project/issues/7/comments?per_page=50&page=1': page,
        'repos/sample/project/issues/7/comments?per_page=50&page=2': page.map((c) => ({ ...c, id: c.id + 50 })),
        'repos/sample/project/pulls/7/reviews?per_page=50&page=1': [
          { ...comment, id: 200, state: 'APPROVED', submitted_at: null },
        ],
        'repos/sample/project/pulls/7/comments?per_page=50&page=1': [
          { ...comment, id: 201, path: 'src/main.ts', diff_hunk: '@@ -1 +1 @@' },
        ],
        'repos/sample/project/pulls/7/files?per_page=50&page=1': [
          { filename: 'src/main.ts', blob_url: `${url}/files`, status: 'modified', additions: 1, deletions: 1 },
        ],
        [`repos/sample/project/commits/${sha}/check-runs?per_page=50&page=1`]: {
          total_count: 1,
          check_runs: [
            { id: 21, html_url: `${url}/checks/21`, name: 'ci', status: 'completed', conclusion: 'failure' },
          ],
        },
        [`repos/sample/project/commits/${sha}/statuses?per_page=50&page=1`]: [
          { id: 203, context: 'deploy', state: 'pending', target_url: null, description: null },
        ],
      };

      await fake(dir, responses);
      const args = ['gh-evidence', '--repository', 'sample/project', '--number', '7', '--error-format', 'json'];
      const ok = await run(dir, env, args);

      expect(ok.code).toBe(0);
      const rows = ok.out
        .trim()
        .split('\n')
        .slice(1)
        .map((line) => JSON.parse(line));

      expect(rows).toHaveLength(106);
      expect(rows[0].annotations.acquisition.truncated).toEqual(['issueComments']);
      expect(rows[1].value.body).toBe('Reproduce this');
      expect(rows.find((r) => r.id === 'reviewComments:201').value.diff_hunk).toBe('@@ -1 +1 @@');
      expect(rows.find((r) => r.id === 'files:src/main.ts').source.path).toBe(`${url}/files`);
      expect(rows.find((r) => r.id === 'checkRuns:21').value.conclusion).toBe('failure');
      expect(rows.at(-1).value.state).toBe('pending');
      const paths = (await readFile(join(dir, 'log'), 'utf8')).trim().split('\n');

      expect(paths).toHaveLength(8); // pull + two comment pages + one page for each other kind
      expect(paths.every((line) => line.startsWith('api --method GET repos/sample/project/'))).toBe(true);
      await fake(dir, { 'repos/sample/project/pulls/7': 'NOT JSON' });
      const malformed = await run(dir, env, args);

      expect(malformed.code).toBe(5);
      expect(malformed.err).toContain('Malformed GitHub response');
      expect(malformed.err).not.toContain('NOT JSON');
      await fake(dir, { 'repos/sample/project/pulls/7': 'x'.repeat(300_000) });
      const oversized = await run(dir, env, args);

      expect(oversized.code).toBe(5);
      expect(oversized.err).toContain('GitHub response exceeds 256 KiB');
      expect(oversized.err).not.toContain('x'.repeat(100));
      await fake(dir, { 'repos/sample/project/pulls/7': { ...pull, number: 8 } });
      expect((await run(dir, env, args)).code).toBe(5);
      await fake(dir, {
        'repos/sample/project/pulls/7': pull,
        'repos/sample/project/issues/7/comments?per_page=50&page=1': Array.from({ length: 51 }, () => ({ ...comment })),
      });
      expect((await run(dir, env, args)).err).toContain('Invalid GitHub page');
      await fake(dir, {}, "printf '%s' 'PRIVATE TOKEN' >&2\nexit 1\n");
      const failed = await run(dir, env, args);

      expect(failed.err).toContain('check authentication and network');
      expect(failed.err).not.toContain('PRIVATE TOKEN');
      await fake(dir, {}, 'exec sleep 8\n');
      const start = Date.now();

      const timed = await run(dir, env, args);

      expect(timed.code).toBe(5);
      expect(timed.err).toContain('GitHub request timed out');
      expect(Date.now() - start).toBeLessThan(7000);
      const pid = Number(await readFile(join(dir, 'pid'), 'utf8'));

      expect(() => process.kill(pid, 0)).toThrow();
      await rm(join(dir, 'bin', 'gh'));
      const missing = await run(dir, { ...env, PATH: join(dir, 'bin') }, args);

      expect(missing.err).toContain('gh is not installed or not on PATH');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  40000,
);

test.skipIf(process.platform === 'win32')(
  'SIGINT cancels the pending gh child',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ribbit-gh-cancel-'));

    try {
      await mkdir(join(dir, 'bin'));
      await mkdir(join(dir, 'commands'));
      await writeFile(
        join(dir, 'commands', 'gh-evidence.yaml'),
        await readFile(resolve('examples/commands/gh-evidence.yaml'), 'utf8'),
      );
      const env = {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
        GH_LOG: join(dir, 'log'),
        XDG_CONFIG_HOME: join(dir, 'config'),
        XDG_DATA_HOME: join(dir, 'data'),
      };

      expect((await run(dir, env, ['extensions', 'add', source])).code).toBe(0);
      await fake(dir, {}, 'exec sleep 8\n');
      const p = Bun.spawn([process.execPath, cli, 'gh-evidence', '--repository', 'sample/project', '--number', '7'], {
        cwd: dir,
        env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      for (let i = 0; i < 100; i++) {
        try {
          if ((await readFile(join(dir, 'log'), 'utf8')).includes('api ')) break;
        } catch {
          /* not started */
        }
        await Bun.sleep(25);
      }
      expect(await readFile(join(dir, 'log'), 'utf8')).toContain('api ');
      p.kill('SIGINT');
      expect(await p.exited).toBe(130);
      expect(await new Response(p.stderr).text()).not.toContain('secret');
      const pid = Number(await readFile(join(dir, 'pid'), 'utf8'));

      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  20000,
);

async function offlineSandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-gh-offline-'));
  const cloned = join(dir, 'gh-evidence');

  try {
    await cp(source, cloned, { recursive: true });
    await mkdir(join(dir, 'bin'));
    await mkdir(join(dir, 'commands'));
    await writeFile(join(dir, 'bin', 'gh'), '#!/bin/sh\nprintf trap >> "$GH_LOG"\nexit 99\n', { mode: 0o755 });
    await writeFile(
      join(dir, 'commands', 'gh-evidence.yaml'),
      await readFile(resolve('examples/commands/gh-evidence.yaml'), 'utf8'),
    );

    return {
      dir,
      cloned,
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
        GH_LOG: join(dir, 'log'),
        XDG_CONFIG_HOME: join(dir, 'config'),
        XDG_DATA_HOME: join(dir, 'data'),
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function run(cwd: string, env: Record<string, string | undefined>, args: string[]) {
  const p = Bun.spawn([process.execPath, cli, ...args], { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);

  return { out, err, code };
}

async function fake(dir: string, responses: Record<string, unknown>, before = '') {
  const cases = Object.entries(responses)
    .map(
      ([path, value]) =>
        `  ${JSON.stringify(path)}) printf '%s' '${(typeof value === 'string' ? value : JSON.stringify(value)).replaceAll("'", "'\\''")}' ;;`,
    )
    .join('\n');

  await writeFile(
    join(dir, 'bin', 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GH_LOG"\nprintf '%s' "$$" > "${join(dir, 'pid')}"\n${before}case "$4" in\n${cases}\n  *) printf '%s' '[]' ;;\nesac\n`,
    { mode: 0o755 },
  );
}
