import { expect, test } from 'bun:test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sandbox } from '../../scripts/release/harness.ts';
import { configSchema } from '../../src/config/index.ts';

for (const mode of ['source', 'compiled'] as const)
  test(`${mode} concrete inspection and scoped readiness stay offline`, async () => {
    const requests: string[] = [];
    const bodies: unknown[] = [];
    let probeStatus = 200;
    let models = ['synthetic'];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;

        // Host-side Go probes visit newly opened ports. Ribbit uses Bun's HTTP client;
        // keep counting every other request, including accidental Bun requests to /.
        if (request.method === 'GET' && path === '/' && request.headers.get('user-agent') === 'Go-http-client/1.1')
          return new Response(null, { status: 404 });
        requests.push(request.method + ' ' + path);
        if (request.method === 'GET')
          return Response.json({ data: models.map((id) => ({ id })) }, { status: probeStatus });
        bodies.push(await request.json());

        // Synthetic response for execution/inspection parity, not model-quality evidence.
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '{"owner":"Mina"}' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    const env = await sandbox();
    const configPath = join(env.dir, 'config/ribbit/config.yaml');
    const run = async (args: string[], extraEnv: Record<string, string> = {}, input = '') => {
      const child = Bun.spawn(
        [...(mode === 'source' ? [process.execPath, resolve('src/cli/main.ts')] : [env.binary]), ...args],
        {
          cwd: env.dir,
          env: { ...env.env, ...extraEnv },
          stdin: new Blob([input]),
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
      await fetch(`http://127.0.0.1:${server.port}/`);
      expect(requests).toEqual(['GET /']);
      requests.length = 0;
      const empty = await run(['doctor', '--json']);

      expect(empty.code, JSON.stringify(empty)).toBe(3);
      const exact = await run(
        ['route', 'inspect', '--json', '--', 'tree', 'does-not-exist', '--describe=false'],
        {},
        'Unread stdin',
      );

      expect(exact.code, exact.err).toBe(0);
      expect(JSON.parse(exact.out)).toMatchObject({
        inference: { status: 'exact', capabilities: [] },
        route: null,
        args: { describe: false, depth: 3 },
      });
      const scoped = await run(['doctor', '--json', '--', 'take', '1'], { PATH: join(env.dir, 'empty-path') });

      expect(scoped.code, scoped.err).toBe(0);
      const config = configSchema.parse({
        providers: {
          selected: {
            type: 'openai-compatible',
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            defaultModel: 'synthetic',
            capabilities: ['object'],
          },
        },
        default: { provider: 'selected' },
      });

      await writeFile(configPath, JSON.stringify(config));
      const before = await readFile(configPath, 'utf8');

      for (const command of [
        ['find', 'missing', '--about', 'evidence'],
        ['tree', 'missing', '--describe'],
        ['pick', '--about', 'evidence'],
        ['map', 'extract', '--schema', 'missing.json'],
      ]) {
        const result = await run(['route', 'inspect', '--json', '--', ...command]);

        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({
          inference: { status: 'semantic', capabilities: ['object'] },
          route: { provider: 'selected', model: 'synthetic' },
        });
      }
      const wrong = await run(['route', 'inspect', '--json', '--', 'map', 'text']);

      expect(wrong.code).toBe(3);
      const doctor = await run([
        'doctor',
        '--json',
        '--probe=false',
        '--',
        'map',
        'extract',
        '--schema',
        'missing.json',
      ]);

      expect(doctor.code, doctor.err).toBe(0);
      expect(requests).toEqual([]);
      const probed = await run(['doctor', '--json', '--probe', '--', 'map', 'extract', '--schema', 'missing.json']);

      expect(probed.code, probed.err).toBe(0);
      expect(requests).toEqual(['GET /v1/models']);
      expect(await readFile(configPath, 'utf8')).toBe(before);
      requests.length = 0;
      for (const args of [
        ['route', 'inspect', 'find'],
        ['route', 'inspect', '--json', '--'],
        ['route', 'inspect', '--json', '--', 'ask'],
        ['route', 'inspect', '--json', '--', 'take', '1', '--force-profile', 'x'],
        ['doctor', '--json', '--probe=invalid'],
        ['doctor', '--json', '--', 'take', '1', '--input', 'wrong'],
        ['route', 'inspect', '--', 'tree', '--describe=false', '--describe'],
        ['route', 'inspect', '--', 'where', 'ok', '--args-json', '{"equals":false}', '--field', 'ok'],
      ])
        expect((await run(args)).code, JSON.stringify(args)).toBe(2);
      for (const target of [
        ['take', '1', '--max-requests', '0'],
        ['take', '1', '--input', 'wrong'],
        ['take', '1', '--output', 'json'],
        ['tree', '--file', 'not-read'],
        ['map', 'x', '--input', 'lines', '--provider', ''],
        ['map', 'x', '--input', 'lines', '--model', ''],
      ]) {
        const execution = await run(target, {}, 'Mina\n');
        const inspection = await run(['route', 'inspect', '--', ...target]);

        expect(inspection.code, JSON.stringify(target)).toBe(execution.code);
        expect(inspection.err).toBe(execution.err);
      }
      expect((await run(['route', 'inspect', '--', 'map', '--help'])).out).toContain('Type: @ribbit/map');
      expect((await run(['doctor', '--probe', '--', 'map', '--help'])).code).toBe(0);
      const typed = await run(['route', 'inspect', '--json', '--', 'where', 'ok', '--args-json', '{"equals":false}']);

      expect(JSON.parse(typed.out).args).toEqual({ field: 'ok', equals: false });
      const literal = await run(['route', 'inspect', '--json', '--', 'ask', '--provider', 'selected', '--', '--help']);

      expect(literal.code).toBe(3); // A literal instruction selects text, not help.
      expect(requests).toEqual([]);

      config.providers.selected.apiKeyEnv = 'RIBBIT_INSPECTION_TEST_KEY';
      await writeFile(configPath, JSON.stringify(config));
      const authInspection = await run(
        ['route', 'inspect', '--json', '--', 'map', 'extract', '--schema', 'not-read', '--file', 'missing-input'],
        {},
        'Unread stdin',
      );

      expect(authInspection.code, authInspection.err).toBe(0);
      expect(authInspection.out).not.toContain('RIBBIT_INSPECTION_TEST_KEY');
      const missingAuth = await run(['doctor', '--json', '--', 'map', 'extract', '--schema', 'not-read']);

      expect(missingAuth.code).toBe(3);
      expect(JSON.parse(missingAuth.out).checks).toContainEqual(
        expect.objectContaining({ name: 'route', status: 'complete', ok: true }),
      );
      expect(JSON.parse(missingAuth.out).checks).toContainEqual(
        expect.objectContaining({ name: 'authentication', status: 'missing', ok: false }),
      );
      const authenticated = await run(
        ['doctor', '--json', '--probe=false', '--', 'map', 'extract', '--schema', 'not-read'],
        { RIBBIT_INSPECTION_TEST_KEY: 'synthetic-not-a-credential' },
      );

      expect(authenticated.code, authenticated.err).toBe(0);
      expect(authenticated.out).not.toContain('synthetic-not-a-credential');
      expect(authenticated.out).not.toContain('RIBBIT_INSPECTION_TEST_KEY');
      delete config.providers.selected.apiKeyEnv;
      config.providers.selected.models = ['different'];
      await writeFile(configPath, JSON.stringify(config));
      const disallowed = await run(['doctor', '--json', '--', 'map', 'extract', '--schema', 'not-read']);

      expect(disallowed.code).toBe(3);
      expect(JSON.parse(disallowed.out).checks).toContainEqual(
        expect.objectContaining({ name: 'model', status: 'not-allowlisted' }),
      );
      delete config.providers.selected.models;
      config.default.temperature = 0;
      await writeFile(configPath, JSON.stringify(config));
      const controls = await run(['doctor', '--json', '--', 'map', 'extract', '--schema', 'not-read']);

      expect(controls.code).toBe(3);
      expect(JSON.parse(controls.out).checks).toContainEqual(
        expect.objectContaining({ name: 'capabilities', missing: ['temperature'] }),
      );
      delete config.default.temperature;
      await writeFile(configPath, JSON.stringify(config));
      const unsupported = await run(['doctor', '--json', '--', 'map', 'text']);

      expect(unsupported.code).toBe(3);
      expect(JSON.parse(unsupported.out).checks).toContainEqual(
        expect.objectContaining({ name: 'capabilities', status: 'unsupported', missing: ['text'] }),
      );
      expect(requests).toEqual([]);
      models = [];
      expect((await run(['doctor', '--json', '--probe', '--', 'map', 'extract', '--schema', 'not-read'])).code).toBe(3);
      probeStatus = 503;
      expect((await run(['doctor', '--json', '--probe', '--', 'map', 'extract', '--schema', 'not-read'])).code).toBe(3);
      probeStatus = 200;
      models = ['synthetic'];
      requests.length = 0;

      await mkdir(join(env.dir, 'commands'));
      await writeFile(
        join(env.dir, 'owner.json'),
        JSON.stringify({
          type: 'object',
          properties: { owner: { type: 'string' } },
          required: ['owner'],
          additionalProperties: false,
        }),
      );
      await writeFile(
        join(env.dir, 'commands/owner.yaml'),
        JSON.stringify({
          apiVersion: 'ribbit/v1',
          kind: 'Command',
          name: 'owner',
          type: '@ribbit/map',
          typeVersion: '1.0.0',
          action: 'run',
          defaults: { instruction: 'Extract owner', schema: 'owner.json', annotate: 'saved' },
          inference: { model: 'definition-model' },
        }),
      );
      config.providers.other = {
        ...config.providers.selected,
        baseUrl: `http://127.0.0.1:${server.port}/other/v1`,
        defaultModel: 'other-default',
      };
      config.profiles.chosen = { provider: 'other', model: 'profile-model' };
      config.routes.owner = { model: 'command-model' };
      await writeFile(configPath, JSON.stringify(config));
      await writeFile(join(env.dir, '.ribbit.yaml'), 'apiVersion: ribbit/v1\ninference: {model: project-model}\n');
      for (const [overrides, expected] of [
        [[], { provider: 'selected', model: 'definition-model' }],
        [['--model', 'override'], { provider: 'selected', model: 'override' }],
        [['--provider', 'other'], { provider: 'other', model: 'other-default' }],
        [['--profile', 'chosen'], { provider: 'other', model: 'profile-model' }],
        [['--profile', 'chosen', '--model', 'last'], { provider: 'other', model: 'last' }],
      ] as const) {
        requests.length = 0;
        const inspected = await run([
          'route',
          'inspect',
          '--json',
          '--',
          'run',
          'owner',
          '--annotate',
          'overridden',
          ...overrides,
        ]);

        expect(inspected.code, inspected.err).toBe(0);
        const plan = JSON.parse(inspected.out);

        expect(plan.route).toMatchObject(expected);
        expect(plan.args).toMatchObject({ annotate: 'overridden', schema: 'owner.json' });
        expect(requests).toEqual([]);
        const executed = await run(
          ['run', 'owner', '--annotate', 'overridden', '--input', 'lines', '--stats', ...overrides],
          {},
          'Mina\n',
        );

        expect(executed.code, executed.err).toBe(0);
        expect(JSON.parse(executed.err).routes).toEqual([{ ...expected, source: plan.route.source }]);
        expect(bodies.at(-1)).toMatchObject({ model: expected.model });
      }
      requests.length = 0;
      await writeFile(
        join(env.dir, 'commands/look.yaml'),
        JSON.stringify({
          apiVersion: 'ribbit/v1',
          kind: 'Command',
          name: 'look',
          type: '@ribbit/tree',
          typeVersion: '1.0.0',
          action: 'run',
          defaults: { describe: true, depth: 1 },
        }),
      );
      const savedMode = await run(['route', 'inspect', '--json', '--', 'look']);

      expect(JSON.parse(savedMode.out)).toMatchObject({
        args: { describe: true, depth: 1 },
        inference: { status: 'semantic' },
      });
      const overriddenMode = await run(['route', 'inspect', '--json', '--', 'look', '--describe=false']);

      expect(JSON.parse(overriddenMode.out)).toMatchObject({
        args: { describe: false, depth: 1 },
        inference: { status: 'exact' },
        route: null,
      });
      await writeFile(
        join(env.dir, 'pending.yaml'),
        JSON.stringify({
          apiVersion: 'ribbit/v1',
          kind: 'Flow',
          name: 'pending',
          input: { type: 'boolean' },
          steps: [{ id: 'tree', command: 'tree', args: { describe: { $ref: 'input' } } }],
        }),
      );
      const pending = await run(['flow', 'plan', 'pending.yaml']);

      expect(JSON.parse(pending.out).steps[0]).toMatchObject({
        inference: { status: 'unresolved', arguments: ['describe'], references: ['input'] },
        route: null,
      });
      const projectOnly = await run(['route', 'inspect', '--json', '--', 'find', '--about', 'evidence']);

      expect(JSON.parse(projectOnly.out).route).toMatchObject({ model: 'project-model', source: { model: 'project' } });
      await writeFile(join(env.dir, '.ribbit.yaml'), 'apiVersion: ribbit/v1\ninference: {}\n');
      models = ['synthetic'];
      expect((await run(['doctor', '--json', '--probe=false'])).code).toBe(0);
      expect(requests).toEqual([]);
      expect((await run(['doctor', '--json', '--probe', '--', 'find', '--about', 'evidence'])).code).toBe(0);
      expect(requests).toEqual(['GET /v1/models']);
      requests.length = 0;
      expect((await run(['doctor', '--json', '--probe'])).code).toBe(0);
      expect(requests.toSorted()).toEqual(['GET /other/v1/models', 'GET /v1/models']);
      requests.length = 0;
      await writeFile(configPath, 'broken: [');
      const broken = await run(['doctor', '--json']);

      expect(broken.code).toBe(3);
      expect(JSON.parse(broken.out)).toMatchObject({ status: 'unavailable' });
      expect(JSON.parse(broken.out).checks).toContainEqual(
        expect.objectContaining({ name: 'configuration', status: 'invalid' }),
      );
      // An unreadable synthetic dotenv path must not block target help.
      await mkdir(join(env.dir, '.env'));
      for (const args of [
        ['route', 'inspect', '--', 'map', '--help'],
        ['doctor', '--probe', '--', 'map', '--help'],
      ]) {
        const help = await run(args);

        expect(help.code, help.err).toBe(0);
        expect(help.out).toContain('Type: @ribbit/map');
      }
      const badEnvironment = await run(['doctor', '--json', '--probe=false']);

      expect(badEnvironment.code).toBe(3);
      expect(JSON.parse(badEnvironment.out).checks).toContainEqual(
        expect.objectContaining({ name: 'configuration', status: 'invalid' }),
      );
      expect(requests).toEqual([]);
    } finally {
      await env.close();
      server.stop(true);
    }
  }, 30000);
