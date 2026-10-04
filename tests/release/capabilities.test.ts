import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sandbox } from '../../scripts/release/harness.ts';

// Synthetic replies test admission and record contracts, not model quality.
test('packaged map modes, saved defaults and flow bindings use the same capability contract', async () => {
  const requests: { path: string; body: unknown }[] = [];
  let reply = 'Mina';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requests.push({
        path: new URL(request.url).pathname,
        body: request.method === 'POST' ? await request.json() : null,
      });

      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const provider = {
    type: 'openai-compatible',
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    defaultModel: 'synthetic',
  };
  const env = await sandbox({
    providers: { text: { ...provider, capabilities: ['text'] }, object: { ...provider, capabilities: ['object'] } },
    default: { provider: 'text' },
  });
  const schema = {
    type: 'object',
    properties: { owner: { type: 'string' } },
    required: ['owner'],
    additionalProperties: false,
  };
  const record = { id: 'original', value: 'Mina', source: { path: 'synthetic.txt' }, annotations: { prior: true } };
  const input = JSON.stringify({ $ribbit: { version: 1, kind: 'records' } }) + '\n' + JSON.stringify(record) + '\n';

  try {
    await writeFile(join(env.dir, 'owner.json'), JSON.stringify(schema));
    await mkdir(join(env.dir, 'commands'));
    await writeFile(
      join(env.dir, 'commands/owner.yaml'),
      JSON.stringify({
        apiVersion: 'ribbit/v1',
        kind: 'Command',
        name: 'owner',
        type: '@ribbit/map',
        typeVersion: '1.0.0',
        action: 'run',
        defaults: { instruction: 'Extract owner', schema: 'owner.json' },
        inference: { provider: 'object' },
      }),
    );
    for (const structured of [false, true]) {
      reply = structured ? JSON.stringify({ owner: 'Mina' }) : 'Mina';
      for (const annotate of [false, true]) {
        requests.length = 0;
        const result = await env.run(
          [
            'map',
            'Extract owner',
            ...(structured ? ['--schema', 'owner.json'] : []),
            '--provider',
            structured ? 'object' : 'text',
            ...(annotate ? ['--annotate', 'result'] : []),
            '--input',
            'records',
          ],
          input,
        );

        expect(result.code, result.err).toBe(0);
        expect(requests.length).toBe(1);
        const output = JSON.parse(result.out.trim().split('\n')[1]);
        const value = structured ? { owner: 'Mina' } : 'Mina';

        expect(output).toEqual(
          annotate
            ? { ...record, annotations: { prior: true, result: value } }
            : { ...record, value, annotations: { prior: true, map: { originId: 'original' } } },
        );
        expect(requests[0].body).toMatchObject(
          structured ? { response_format: { json_schema: { schema } } } : { model: 'synthetic' },
        );
        if (!structured) expect(requests[0].body).not.toHaveProperty('response_format');
      }
      requests.length = 0;
      const wrong = await env.run(
        [
          'map',
          'Extract owner',
          ...(structured ? ['--schema', 'owner.json'] : []),
          '--provider',
          structured ? 'text' : 'object',
          '--input',
          'records',
        ],
        input,
      );

      expect(wrong.code).toBe(3);
      expect(wrong.err).toContain(`map/run requires ${structured ? 'object' : 'text'}`);
      expect(wrong.err).toContain('Select an explicitly configured compatible route');
      expect(requests).toEqual([]);
    }
    requests.length = 0;
    const inspect = await env.run(['route', 'inspect', '--json', '--', 'owner']);

    expect(inspect.code, inspect.err).toBe(0);
    expect(JSON.parse(inspect.out)).toMatchObject({
      route: { provider: 'object' },
      inference: { status: 'semantic', capabilities: ['object'] },
    });
    const planned = await env.run(['flow', 'plan', '--', 'owner']);

    expect(planned.code, planned.err).toBe(0);
    expect(JSON.parse(planned.out).steps[0]).toMatchObject({
      inference: { status: 'semantic', capabilities: ['object'] },
      route: { provider: 'object' },
    });
    expect(requests).toEqual([]);
    reply = JSON.stringify({ owner: 'Mina' });
    expect((await env.run(['owner', '--input', 'records'], input)).code).toBe(0);
    reply = 'Mina';
    expect((await env.run(['owner', '--schema=', '--provider', 'text', '--input', 'records'], input)).code).toBe(0);

    await mkdir(join(env.dir, 'candidates'));
    await writeFile(join(env.dir, 'candidates', 'a.txt'), 'Synthetic evidence');
    for (const args of [
      ['find', 'candidates'],
      ['tree', 'candidates', '--describe=false'],
    ]) {
      requests.length = 0;
      const exact = await env.run(args);

      expect(exact.code, exact.err).toBe(0);
      expect(requests).toEqual([]);
    }
    for (const args of [
      ['find', 'candidates', '--about', 'evidence'],
      ['tree', 'candidates', '--about', 'evidence'],
      ['tree', 'candidates', '--describe'],
    ]) {
      requests.length = 0;
      reply = args.includes('--describe')
        ? JSON.stringify({ descriptions: [{ id: '1', text: 'Synthetic file' }] })
        : JSON.stringify({ ids: ['1'] });
      const semantic = await env.run([...args, '--provider', 'object']);

      expect(semantic.code, semantic.err).toBe(0);
      expect(requests.length).toBe(1);
      requests.length = 0;
      const unsupported = await env.run([...args, '--provider', 'text']);

      expect(unsupported.code).toBe(3);
      expect(requests).toEqual([]);
    }
    reply = 'Mina';
    const flow = {
      apiVersion: 'ribbit/v1',
      kind: 'Flow',
      name: 'bound',
      input: { type: 'string' },
      steps: [
        {
          id: 'map',
          command: 'map',
          args: { instruction: 'Extract owner', schema: { $ref: 'input' } },
          input: [record],
        },
      ],
    };

    await writeFile(join(env.dir, 'bound.yaml'), JSON.stringify(flow));
    requests.length = 0;
    const pending = await env.run(['flow', 'plan', 'bound.yaml']);

    expect(pending.code, pending.err).toBe(0);
    expect(JSON.parse(pending.out).steps[0]).toMatchObject({
      inference: { status: 'unresolved', arguments: ['schema'], references: ['input'] },
      route: null,
    });
    const validation = await env.run(['flow', 'validate', 'bound.yaml']);

    expect(JSON.parse(validation.out)).toMatchObject({
      valid: true,
      complete: false,
      deferred: [{ id: 'map', status: 'unresolved' }],
    });
    expect(requests).toEqual([]);
    const text = await env.run(['flow', 'run', 'bound.yaml', '--input', 'text'], '');

    expect(text.code, text.err).toBe(0);
    expect(requests.length).toBe(1);
    requests.length = 0;
    const unsupported = await env.run(['flow', 'run', 'bound.yaml', '--input', 'text'], 'owner.json');

    expect(unsupported.code, unsupported.err).toBe(3);
    expect(requests).toEqual([]);
    reply = JSON.stringify({ owner: 'Mina' });
    const object = await env.run(
      ['flow', 'run', 'bound.yaml', '--input', 'text', '--provider', 'object'],
      'owner.json',
    );

    expect(object.code, object.err).toBe(0);
    expect(requests.length).toBe(1);
  } finally {
    await env.close();
    server.stop(true);
  }
}, 30000);
