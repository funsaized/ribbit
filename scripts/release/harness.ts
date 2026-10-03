import { binaryName, cleanEnvironment } from '../platform.ts';
import { mkdtemp, mkdir, cp, writeFile, rm, copyFile, symlink, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

export async function evaluationProvenance() {
  const git = async (args: string[]) => {
    const p = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);

    if (code) throw new Error(`Cannot record Git provenance: ${err}`);

    return out.trim();
  };

  return {
    revision: await git(['rev-parse', 'HEAD']),
    worktreeDirty: !!(await git(['status', '--porcelain'])),
    build: JSON.parse(await readFile('dist/build.json', 'utf8')) as unknown,
    evaluatorHashes: Object.fromEntries(
      await Promise.all(
        ['harness.ts', 'evaluate.ts', 'workflows.ts', 'handoff.ts', 'rubric.ts', 'regrade.ts'].map(async (name) => [
          name,
          createHash('sha256')
            .update(await readFile(`scripts/release/${name}`))
            .digest('hex'),
        ]),
      ),
    ),
  };
}

export async function sandbox(config: unknown = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-release-'));

  await cp('fixtures/release', dir, { recursive: true });
  await cp('examples', join(dir, 'examples'), { recursive: true });
  await mkdir(join(dir, 'config/ribbit'), { recursive: true });
  await writeFile(join(dir, 'config/ribbit/config.yaml'), stringify(config));
  const env = {
    ...cleanEnvironment(dir),
    TERM: 'xterm-256color',
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_DATA_HOME: join(dir, 'data'),
  };
  // Freeze the executable so a concurrent build cannot change a running evaluation.
  const binary = join(dir, binaryName);

  await copyFile(resolve('dist', binaryName), binary, process.platform === 'win32' ? 0 : constants.COPYFILE_FICLONE);
  await symlink(resolve('dist/lib'), join(dir, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');

  return {
    dir,
    env,
    binary,
    async run(args: string[], input = '') {
      const started = performance.now();
      const p = Bun.spawn([binary, ...args], {
        cwd: dir,
        env,
        stdin: new Blob([input]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timeout = setTimeout(() => p.kill('SIGKILL'), 125000);

      try {
        const [out, err, code] = await Promise.all([
          new Response(p.stdout).text(),
          new Response(p.stderr).text(),
          p.exited,
        ]);

        return { out, err, code, elapsedMs: performance.now() - started };
      } finally {
        clearTimeout(timeout);
      }
    },
    // Windows can briefly retain executable/directory handles after process exit.
    async close() {
      for (let attempt = 0; ; attempt++) {
        try {
          await rm(dir, { recursive: true, force: true });

          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;

          if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code ?? '') || attempt === 5)
            throw error;
          await Bun.sleep(100 * (attempt + 1));
        }
      }
    },
  };
}

export function mockProvider() {
  let replies: unknown[] = [];
  const requests: any[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === '/v1/models')
        return Response.json({ data: [{ id: 'small' }, { id: 'strong' }] });
      if (req.method !== 'POST') return new Response('Not found', { status: 404 });
      const body = await req.json();

      requests.push(body);
      if (!replies.length) return new Response('Unexpected inference', { status: 400 });
      const value = replies.shift();
      const content = typeof value === 'string' ? value : JSON.stringify(value);

      return new Response(
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const config = {
    providers: {
      mock: {
        type: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        capabilities: ['text', 'object', 'stream', 'maxOutputTokens'],
      },
    },
    profiles: { 'local-small': { provider: 'mock', model: 'small' }, stronger: { provider: 'mock', model: 'strong' } },
    default: { profile: 'local-small' },
  };

  return {
    config,
    requests,
    reset(values: unknown[]) {
      replies = [...values];
      requests.length = 0;
    },
    remaining: () => replies.length,
    close: () => server.stop(true),
  };
}

/** Picker diagnostics may follow terminal control sequences on the same line. */
export function parseStats(stderr: string): any | null {
  let result = null;

  for (const candidate of stderr.matchAll(/\{"schemaVersion":1,"requests":[^\r\n]*\}/g)) {
    try {
      result = JSON.parse(candidate[0]);
    } catch {}
  }

  return result;
}
