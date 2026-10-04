import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { testExtension } from '../../src/scaffold/index.ts';
import { cleanEnvironment } from '../../scripts/platform.ts';

// Synthetic trusted extension: all inference uses fixture responses, never a provider.
const source = `import {defineCommand,defineAction,z,jsonValueSchema} from '@ribbit/sdk';
const config=z.strictObject({enabled:z.boolean().default(true)});
const args=z.strictObject({behavior:z.enum(['echo','throw','text','object','tojson-undefined','tojson-throw','getter','getter-null','getter-undefined']).default('echo')});
const base={config,args,description:'Synthetic fixture diagnostics',capabilities:[],effects:[]};
export default defineCommand({type:'@test/diagnostics',version:'1.0.0',description:'Synthetic',config,actions:{
  run:defineAction({...base,input:jsonValueSchema,output:jsonValueSchema,mode:'value',execute:async({input,args},ctx)=>{
    if(args.behavior==='throw') throw new Error('SYNTHETIC_PRIVATE_EXCEPTION');
    if(args.behavior==='text') return (await ctx.llm.text('synthetic',''))+(await ctx.llm.text('synthetic',''));
    if(args.behavior==='object') return ctx.llm.object('synthetic','',z.strictObject({answer:z.string()}));
    if(args.behavior.startsWith('tojson')) return Object.defineProperty({a:1},'toJSON',{value(){
      if(args.behavior==='tojson-throw') throw new Error('SYNTHETIC_PRIVATE_SERIALIZER');
      return undefined;
    }});
    if(args.behavior.startsWith('getter')) {
      let reads=0;
      return Object.defineProperty({},'a',{enumerable:true,get(){
        // Validation reads twice; the subsequent comparison/diagnostic must not alter the verdict.
        if(++reads>2) {
          if(args.behavior==='getter-null') throw null;
          if(args.behavior==='getter-undefined') throw undefined;
          throw new Error('SYNTHETIC_PRIVATE_GETTER');
        }
        return 1;
      }});
    }
    return input;
  }}),
  string:defineAction({...base,input:z.string(),output:z.string(),mode:'value',execute:({input})=>input}),
  invalid:defineAction({...base,input:z.string(),output:z.string(),mode:'value',execute:()=>42 as unknown as string}),
  records:defineAction({...base,input:jsonValueSchema,output:jsonValueSchema,mode:'records',execute:async function*({input}){yield* input;}}),
  stream:defineAction({...base,input:z.string(),output:z.string(),mode:'text-stream',execute:async function*({input}){
    yield input;
    if(input==='invalid') yield 42 as unknown as string;
    if(input==='throw') throw new Error('SYNTHETIC_PRIVATE_STREAM');
  }})
}});`;

const preview = (type: string, value: string, truncated = false) => ({ type, preview: value, truncated });
const mismatch = (path: string, expected: ReturnType<typeof preview>, actual: ReturnType<typeof preview>) => ({
  kind: 'value-mismatch' as const,
  path,
  expected,
  actual,
});

// Five sequential extension builds/replays need headroom on macOS Intel; keep every parity assertion.
test('fixture diagnostics preserve verdicts and explain bounded deterministic mismatches without providers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-diagnostics-'));
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;

      // Host port discovery probes GET / even without Ribbit; only /v1 is configured as a provider.
      if (!path.startsWith('/v1')) return new Response('Not found', { status: 404 });
      requests.push(`${request.method} ${path}`);

      return new Response('Unexpected provider call', { status: 500 });
    },
  });
  const cases: { name: string; fixture: object; result: object }[] = [];
  const add = (name: string, fixture: object, result: object) => cases.push({ name, fixture, result });
  const wrong = (name: string, expected: unknown, actual: unknown, diagnostic: object) =>
    add(name, { input: actual, expected }, { pass: false, diagnostic });

  try {
    await mkdir(join(dir, 'fixtures'));
    await writeFile(join(dir, 'index.ts'), source);
    add('pass', { input: { b: [null, true], a: 1 }, expected: { a: 1, b: [null, true] } }, { pass: true });
    add('pass-null', { input: null, expected: null }, { pass: true });
    add('pass-empty-array', { input: [], expected: [] }, { pass: true });
    wrong('scalar', 'WRONG', 'hello', mismatch('', preview('string', '"WRONG"'), preview('string', '"hello"')));
    wrong('number', 2, 1, mismatch('', preview('number', '2'), preview('number', '1')));
    wrong('boolean', false, true, mismatch('', preview('boolean', 'false'), preview('boolean', 'true')));
    wrong('type', '1', 1, mismatch('', preview('string', '"1"'), preview('number', '1')));
    wrong('null', null, false, mismatch('', preview('null', 'null'), preview('boolean', 'false')));
    wrong('missing-key', { x: null }, {}, mismatch('/x', preview('null', 'null'), preview('missing', '<missing>')));
    wrong('extra-key', {}, { x: null }, mismatch('/x', preview('missing', '<missing>'), preview('null', 'null')));
    wrong(
      'literal-missing',
      { x: 'missing' },
      {},
      mismatch('/x', preview('string', '"missing"'), preview('missing', '<missing>')),
    );
    add(
      'missing-expected',
      { input: null },
      { pass: false, diagnostic: mismatch('', preview('missing', '<missing>'), preview('null', 'null')) },
    );
    wrong('key-order', { z: 2, a: 1 }, { z: 9, a: 0 }, mismatch('/a', preview('number', '1'), preview('number', '0')));
    wrong(
      'key-order-reversed',
      { a: 1, z: 2 },
      { a: 0, z: 9 },
      mismatch('/a', preview('number', '1'), preview('number', '0')),
    );
    wrong(
      'escaped-key',
      { 'a/b~c': { '': 2 } },
      { 'a/b~c': { '': 1 } },
      mismatch('/a~1b~0c/', preview('number', '2'), preview('number', '1')),
    );
    wrong(
      'inherited-key',
      { toString: 1 },
      {},
      mismatch('/toString', preview('number', '1'), preview('missing', '<missing>')),
    );
    wrong('array-value', [1, 3], [1, 2], mismatch('/1', preview('number', '3'), preview('number', '2')));
    wrong('array-order', [2, 1], [1, 2], mismatch('/0', preview('number', '2'), preview('number', '1')));
    wrong('array-short', [1, null], [1], mismatch('/1', preview('null', 'null'), preview('missing', '<missing>')));
    wrong('array-long', [], [null], mismatch('/0', preview('missing', '<missing>'), preview('null', 'null')));
    wrong('array-type', [], {}, mismatch('', preview('array', '[]'), preview('object', '{}')));
    wrong(
      'array-numeric-order',
      Array(12).fill(1),
      [1, 1, 2, ...Array(9).fill(2)],
      mismatch('/2', preview('number', '1'), preview('number', '2')),
    );
    wrong(
      'nested',
      { items: [{ name: 'Ada' }] },
      { items: [{ name: 'Jo' }] },
      mismatch('/items/0/name', preview('string', '"Ada"'), preview('string', '"Jo"')),
    );
    wrong(
      'large-string',
      'x'.repeat(1000),
      'y'.repeat(1000),
      mismatch('', preview('string', '"' + 'x'.repeat(255), true), preview('string', '"' + 'y'.repeat(255), true)),
    );
    wrong(
      'large-array',
      Array(1000).fill(1),
      null,
      mismatch('', preview('array', JSON.stringify(Array(1000).fill(1)).slice(0, 256), true), preview('null', 'null')),
    );
    const largeObject = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, 'x'.repeat(10)]));
    const sortedObject = Object.fromEntries(
      Object.keys(largeObject)
        .toSorted()
        .map((key) => [key, largeObject[key]]),
    );

    wrong(
      'large-object',
      largeObject,
      null,
      mismatch('', preview('object', JSON.stringify(sortedObject).slice(0, 256), true), preview('null', 'null')),
    );
    const deep = (value: unknown): unknown => Array.from({ length: 40 }).reduce((v) => ({ x: v }), value);

    wrong('deep', deep(1), deep(2), { kind: 'value-mismatch', path: '/x'.repeat(32), pathTruncated: true });
    wrong(
      'long-key',
      { ['x'.repeat(600)]: 1 },
      { ['x'.repeat(600)]: 2 },
      { kind: 'value-mismatch', path: '', pathTruncated: true },
    );
    add('expected-error', { action: 'string', input: 42, error: 2 }, { pass: true, error: 2, location: 'input' });
    add(
      'wrong-error',
      { action: 'string', input: 42, error: 5 },
      {
        pass: false,
        error: 2,
        location: 'input',
        diagnostic: {
          kind: 'error-mismatch',
          expected: { outcome: 'error', code: 5 },
          actual: { outcome: 'error', code: 2 },
        },
      },
    );
    add(
      'missing-error',
      { input: 'ok', expected: 'ok', error: 2 },
      {
        pass: false,
        diagnostic: { kind: 'error-mismatch', expected: { outcome: 'error', code: 2 }, actual: { outcome: 'return' } },
      },
    );
    for (const [name, fixture, location, error] of [
      ['args', { input: 'ok', args: { extra: true } }, 'args', 2],
      ['config', { input: 'ok', config: { enabled: 'bad' } }, 'config', 2],
      ['input', { action: 'string', input: 42 }, 'input', 2],
      ['output', { action: 'invalid', input: 'ok' }, 'output', 5],
      ['stream-output', { action: 'stream', input: 'invalid' }, 'output', 5],
    ] as const)
      add(name, fixture, { pass: false, error, location, diagnostic: { kind: 'execution-failure' } });
    add(
      'throw',
      { input: null, args: { behavior: 'throw' } },
      {
        pass: false,
        error: 5,
        message: 'Extension execution failed (details redacted)',
        diagnostic: { kind: 'execution-failure' },
      },
    );
    add(
      'stream-throw',
      { action: 'stream', input: 'throw' },
      {
        pass: false,
        error: 5,
        message: 'Extension stream failed (details redacted)',
        diagnostic: { kind: 'execution-failure' },
      },
    );
    add('expected-throw', { input: null, args: { behavior: 'throw' }, error: 5 }, { pass: true, error: 5 });
    add(
      'records',
      { action: 'records', input: [{ x: 1 }], expected: [{ x: 2 }] },
      { pass: false, diagnostic: mismatch('/0/x', preview('number', '2'), preview('number', '1')) },
    );
    add(
      'stream',
      { action: 'stream', input: 'hello', expected: ['WRONG'] },
      { pass: false, diagnostic: mismatch('/0', preview('string', '"WRONG"'), preview('string', '"hello"')) },
    );
    add(
      'mock-text',
      { input: null, args: { behavior: 'text' }, responses: ['one', 'two'], expected: 'onetwo' },
      { pass: true },
    );
    add(
      'mock-object',
      { input: null, args: { behavior: 'object' }, responses: [{ answer: 'yes' }], expected: { answer: 'yes' } },
      { pass: true },
    );
    add(
      'mock-missing',
      { input: null, args: { behavior: 'text' } },
      {
        pass: false,
        error: 5,
        message: 'Fixture inference response missing',
        diagnostic: { kind: 'execution-failure' },
      },
    );
    add(
      'mock-invalid',
      { input: null, args: { behavior: 'object' }, responses: [{ answer: 42 }] },
      { pass: false, error: 5, diagnostic: { kind: 'execution-failure' } },
    );
    for (const behavior of ['tojson-undefined', 'tojson-throw'])
      add(
        `hook-${behavior}`,
        { input: null, args: { behavior }, expected: null },
        {
          pass: false,
          diagnostic: mismatch('', preview('null', 'null'), preview('object', '<preview unavailable>', true)),
        },
      );
    for (const behavior of ['getter', 'getter-null', 'getter-undefined'])
      add(
        `hook-${behavior}`,
        { input: null, args: { behavior }, expected: {} },
        {
          pass: false,
          diagnostic: { kind: 'diagnostic-unavailable' },
        },
      );
    add(
      'hook-comparison',
      { input: null, args: { behavior: 'getter' }, expected: { a: 2 } },
      {
        pass: false,
        diagnostic: { kind: 'diagnostic-unavailable' },
      },
    );
    add('zz-after-hooks', { input: 'still runs', expected: 'still runs' }, { pass: true });
    // Keep negative zero intact: JSON.stringify would erase this equality distinction.
    await writeFile(join(dir, 'fixtures/negative-zero.json'), '{"input":0,"expected":-0}');
    await writeFile(join(dir, 'fixtures/malformed.json'), '{SYNTHETIC_PRIVATE_MALFORMED');
    for (const { name, fixture } of cases)
      await writeFile(join(dir, 'fixtures', name + '.json'), JSON.stringify(fixture));
    const report = await testExtension(dir);

    for (const { name, result } of cases) {
      const row = report.results.find((r) => r.file === name + '.json');

      expect(row, name).toMatchObject(result);
      if ('pass' in result && result.pass) expect(row).not.toHaveProperty('diagnostic');
      if (name.startsWith('hook-')) expect(row).not.toHaveProperty('error');
    }
    expect(report.results.find((r) => r.file === 'negative-zero.json')?.diagnostic).toEqual(
      mismatch('', preview('number', '-0'), preview('number', '0')),
    );
    expect(report.results.find((r) => r.file === 'malformed.json')).toEqual({
      file: 'malformed.json',
      pass: false,
      error: 2,
      location: 'malformed.json',
      message: 'Invalid fixture JSON',
      diagnostic: { kind: 'fixture-json' },
    });
    expect(report.passed).toBe(8);
    expect(report.failed).toBe(cases.length + 2 - report.passed);
    expect(report.results.map((r) => r.file)).toEqual(report.results.map((r) => r.file).toSorted());
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain('SYNTHETIC_PRIVATE');
    expect(JSON.stringify(await testExtension(dir))).toBe(serialized);
    for (const row of report.results) {
      if (row.diagnostic?.kind !== 'value-mismatch') continue;
      expect(row.diagnostic.path.length).toBeLessThanOrEqual(512);
      for (const value of [row.diagnostic.expected, row.diagnostic.actual])
        expect(value.preview.length).toBeLessThanOrEqual(256);
    }
    await mkdir(join(dir, 'config/ribbit'), { recursive: true });
    await writeFile(
      join(dir, 'config/ribbit/config.yaml'),
      `providers:\n  mock:\n    type: openai-compatible\n    baseUrl: http://127.0.0.1:${server.port}/v1\n    capabilities: [text, object]\ndefault:\n  provider: mock\n  model: synthetic\n`,
    );
    // package:smoke supplies its copied binary to replay this same matrix with adjacent SDK support.
    const executable = process.env.RIBBIT_FIXTURE_TEST_BINARY;
    const cli = executable ? [executable] : [process.execPath, resolve('src/cli/main.ts')];
    let firstJson: string | undefined;

    for (const flags of [['--json'], ['--json'], []]) {
      const child = Bun.spawn([...cli, 'extensions', 'test', dir, ...flags], {
        cwd: dir,
        env: { ...cleanEnvironment(dir), XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data') },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(code).toBe(5);
      expect(err).toBe('');
      expect(JSON.parse(out)).toEqual(flags.length ? { schemaVersion: 1, ...report } : report);
      if (flags.length) {
        if (firstJson !== undefined) expect(out).toBe(firstJson);
        firstJson = out;
      }
    }
    expect(requests).toEqual([]);
  } finally {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);
