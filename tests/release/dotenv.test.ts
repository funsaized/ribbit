import { expect, test } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sandbox } from '../../scripts/release/harness.ts';

for (const mode of ['source', 'compiled'] as const)
  test(`${mode} inspection loads dotenv before resolving global definitions, except for help`, async () => {
    const env = await sandbox();
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;

        // Ignore host-side port probes, but count every request from Bun, including /.
        if (path === '/' && request.headers.get('user-agent') === 'Go-http-client/1.1')
          return new Response(null, { status: 404 });
        requests.push(request.method + ' ' + path);

        return Response.json({ data: [{ id: 'synthetic' }] });
      },
    });
    const entry = resolve('src/cli/main.ts');
    const binary = join(env.dir, process.platform === 'win32' ? 'no-env.exe' : 'no-env');
    const childEnv: NodeJS.ProcessEnv = { ...env.env };

    delete childEnv.XDG_CONFIG_HOME;
    const run = async (args: string[], override?: string) => {
      const child = Bun.spawn(
        [...(mode === 'source' ? [process.execPath, '--no-env-file', entry] : [binary]), ...args],
        {
          cwd: env.dir,
          env: { ...childEnv, ...(override ? { XDG_CONFIG_HOME: override } : {}) },
          stdin: new Blob(['one\ntwo\nthree\n']),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { out, err, code };
    };

    try {
      if (mode === 'compiled') {
        const build = Bun.spawn(
          [
            process.execPath,
            'build',
            entry,
            '--compile',
            '--no-compile-autoload-dotenv',
            '--define',
            'RIBBIT_COMPILED=true',
            '--outfile',
            binary,
          ],
          { stdout: 'ignore', stderr: 'pipe' },
        );
        const error = await new Response(build.stderr).text();

        expect(await build.exited, error).toBe(0);
      }
      const dotenvHome = join(env.dir, 'dotenv-config');
      const realHome = join(env.dir, 'real-config');

      for (const [home, count] of [
        [dotenvHome, 1],
        [realHome, 2],
      ] as const) {
        await mkdir(join(home, 'ribbit/commands'), { recursive: true });
        await writeFile(
          join(home, 'ribbit/commands/chosen.yaml'),
          JSON.stringify({
            apiVersion: 'ribbit/v1',
            kind: 'Command',
            name: 'chosen',
            type: '@ribbit/take',
            typeVersion: '1.0.0',
            action: 'run',
            defaults: { count },
          }),
        );
      }
      // Synthetic path only: no credentials or user configuration are read.
      await writeFile(join(env.dir, '.env'), `XDG_CONFIG_HOME=${JSON.stringify(dotenvHome.replaceAll('\\', '/'))}\n`);
      for (const [override, count] of [
        [undefined, 1],
        [realHome, 2],
      ] as const) {
        for (const target of [['chosen'], ['global:chosen'], ['run', 'chosen']]) {
          const execution = await run([...target, '--input', 'lines', '--output', 'jsonl'], override);

          expect(execution).toEqual({ code: 0, err: '', out: count === 1 ? '"one"\n' : '"one"\n"two"\n' });
          const inspection = await run(['route', 'inspect', '--json', '--', ...target], override);

          expect(inspection.code, inspection.err).toBe(0);
          expect(JSON.parse(inspection.out)).toMatchObject({ args: { count }, route: null });
          const doctor = await run(['doctor', '--json', '--probe=false', '--', ...target], override);

          expect(doctor.code, doctor.err).toBe(0);
          expect(JSON.parse(doctor.out)).toMatchObject({ invocation: { args: { count } }, ok: true });
        }
      }
      await writeFile(
        join(realHome, 'ribbit/config.yaml'),
        JSON.stringify({
          providers: {
            synthetic: {
              type: 'openai-compatible',
              baseUrl: `http://127.0.0.1:${server.port}/v1`,
              defaultModel: 'synthetic',
              capabilities: ['text'],
            },
          },
          default: { provider: 'synthetic' },
        }),
      );
      expect((await run(['doctor', '--json', '--probe', '--', 'ask', 'Synthetic question'], realHome)).code).toBe(0);
      expect(requests).toEqual(['GET /v1/models']);
      requests.length = 0;
      await rm(join(env.dir, '.env'));
      await mkdir(join(env.dir, '.env'));
      for (const probe of ['--probe=false', '--probe']) {
        for (const target of [[], ['take', '1'], ['ask', 'Synthetic question'], ['run', 'chosen']]) {
          const result = await run(['doctor', '--json', probe, ...(target.length ? ['--', ...target] : [])], realHome);

          expect(result.code).toBe(3);
          expect(result.err).toBe('');
          expect(JSON.parse(result.out)).toMatchObject({
            schemaVersion: 1,
            scope: target.length ? 'invocation' : 'installation',
            ok: false,
            status: 'unavailable',
            verification: 'offline',
            probeRequested: probe === '--probe',
            checks: expect.arrayContaining([
              expect.objectContaining({
                name: 'configuration',
                ok: false,
                status: 'invalid',
                message: expect.stringContaining('Invalid .env file'),
              }),
              expect.objectContaining({
                name: 'provider-probes',
                ok: null,
                status: probe === '--probe' ? 'blocked' : 'not-requested',
              }),
            ]),
          });
          expect(requests).toEqual([]);
        }
      }
      for (const args of [
        ['take', '--help'],
        ['route', 'inspect', '--', 'take', '--help'],
        ['doctor', '--probe', '--', 'take', '--help'],
      ]) {
        const help = await run(args);

        expect(help.code, help.err).toBe(0);
        expect(help.out).toContain('Type: @ribbit/take');
      }
    } finally {
      server.stop(true);
      await env.close();
    }
  }, 30000);
