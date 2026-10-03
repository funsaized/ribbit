import { test, expect } from 'bun:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { schemaToZod, externalJsonSchema } from '../../src/build/schema/index.ts';
import { isJson } from '../../src/engine/records/index.ts';
import { semanticCommands } from '../../src/builtins/semantic.ts';
import { ManagedInference } from '../../src/engine/inference/index.ts';
import { Budget, executeAction, type Context } from '../../src/sdk/index.ts';
import { configSchema } from '../../src/config/index.ts';
import { resolveRoute } from '../../src/routing/index.ts';
import type { Adapter } from '../../src/providers/interface/index.ts';
import type { JsonSchema } from '../../src/sdk/manifest/index.ts';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parity: [JsonSchema, unknown[]][] = [
  [{ type: 'string', enum: ['x'], minLength: 10 }, ['x', 'xxxxxxxxxx', null]],
  [{ type: 'string', enum: ['ok', 'no'], pattern: '^o', maxLength: 2 }, ['ok', 'no', 'okay']],
  [{ type: 'number', enum: [1, 3, 5], minimum: 2, maximum: 4 }, [1, 3, 5, '3']],
  [{ type: 'integer', enum: [1.5, 2] }, [1.5, 2]],
  [{ type: 'string', const: 'x', minLength: 2 }, ['x', 'xx']],
  [{ type: 'number', const: 4, exclusiveMaximum: 4 }, [4, 3]],
  [{ type: 'string', const: 4 }, [4, '4']],
  [{ anyOf: [{ const: 'x' }, { const: 'long' }], type: 'string', minLength: 3 }, ['x', 'long', 1]],
  [{ anyOf: [{ type: 'number' }, { type: 'null' }], minimum: 2, maximum: 4 }, [null, 1, 3, 5]],
  [{ type: ['string', 'null'], enum: ['x', 'long', null], minLength: 3 }, [null, 'x', 'long']],
  [{ type: ['integer', 'null'], exclusiveMinimum: 1, maximum: 4, multipleOf: 2 }, [null, 1, 2, 3, 4, 2.5]],
  [{ type: 'string', minLength: 1, maxLength: 1, pattern: '^.$' }, ['a', '😀', 'ab']],
  [{ type: 'integer' }, [Number.MAX_SAFE_INTEGER + 1, 1.5, Infinity, NaN]],
  [{ type: 'number', multipleOf: 0.1 }, [0.2, 0.3, 0.25]],
  [
    { type: 'array', items: { type: 'string', enum: ['ok', 'x'], minLength: 2 }, minItems: 1, maxItems: 2 },
    [[], ['ok'], ['x'], ['ok', 'ok', 'ok']],
  ],
  [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        nested: {
          type: 'object',
          additionalProperties: false,
          required: ['choice'],
          properties: {
            choice: { type: ['string', 'null'], enum: ['ok', 'x', null], minLength: 2, default: 'ok' },
            optional: { const: 2, type: 'integer', minimum: 2, default: 2 },
          },
        },
      },
      required: ['nested'],
    },
    [
      { nested: {} },
      { nested: { choice: null } },
      { nested: { choice: 'x' } },
      { nested: { choice: 'ok', extra: true } },
      {},
    ],
  ],
  [
    {
      type: 'object',
      additionalProperties: false,
      properties: { x: { anyOf: [{ const: 2 }, { const: 4 }], minimum: 3, default: 4 } },
    },
    [{}, { x: 2 }, { x: 4 }],
  ],
  [{ type: 'string', enum: ['ok'], default: 'ok' }, ['ok', null, undefined]],
  [
    {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { x: { type: 'integer', default: 2 } },
          required: ['x'],
        },
        { type: 'null' },
      ],
    },
    [{}, { x: 2 }, null],
  ],
];

test('external schemas enforce exactly AJV semantics, including siblings and defaults', () => {
  const ajv = new Ajv2020({ allErrors: true, useDefaults: true, strict: false });

  for (const [schema, values] of parity) {
    const validate = ajv.compile(schema);
    const converted = schemaToZod(schema);

    expect(externalJsonSchema(converted)).toEqual(schema);
    for (const value of values) {
      const before = structuredClone(value);
      const copy = structuredClone(value);
      const expected = isJson(value) && validate(copy);
      const result = converted.safeParse(value);

      expect(result.success, JSON.stringify({ schema, value })).toBe(expected);
      if (result.success) expect(copy).toEqual(result.data);
      expect(value).toEqual(before);
    }
  }
});

test('unsupported external schemas cannot hide behind enum/const/anyOf', () => {
  for (const schema of [
    { type: 'object', enum: ['x'] },
    { type: 'array', const: null },
    { type: 'string', enum: ['x'], oneOf: [{ const: 'x' }] },
    { anyOf: [{ type: 'object', properties: {} }] },
    { type: 'string', format: 'email' },
    { $ref: 'https://example.test/schema' },
    { type: 'string', enum: [] },
    { type: 'number', minimum: 'wrong' },
    { type: 'number', default: Infinity },
  ])
    expect(() => schemaToZod(schema)).toThrow();
  const supplied = { type: 'string', enum: ['ok'], minLength: 2 };
  const converted = schemaToZod(supplied);

  supplied.minLength = 100;
  externalJsonSchema(converted)!.minLength = 100;
  expect(converted.safeParse('ok').success).toBe(true);
});

const route = resolveRoute(
  configSchema.parse({
    providers: {
      mock: { type: 'ollama', baseUrl: 'http://127.0.0.1:1', defaultModel: 'mock', capabilities: ['text', 'object'] },
    },
    default: { provider: 'mock' },
  }),
  {},
);

test('extract and schema map repair invalid siblings or fail, and send the original schema', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-schema-'));
  const schema = { type: 'string', enum: ['x', 'long'], minLength: 3 };
  const path = join(dir, 'schema.json');

  try {
    await writeFile(path, JSON.stringify(schema));
    for (const command of ['extract', 'map'] as const)
      for (const repaired of [false, true]) {
        let calls = 0;
        const adapter: Adapter = {
          async *stream(request) {
            expect(request.schema).toEqual(schema);
            yield { type: 'text', text: JSON.stringify(++calls === 2 && repaired ? 'long' : 'x') };
            yield { type: 'done' };
          },
        };
        const budget = new Budget();
        const llm = new ManagedInference(adapter, route, budget);
        const ctx: Context = { budget, signal: budget.signal, log() {}, llm };
        const input =
          command === 'extract'
            ? 'evidence'
            : (async function* () {
                yield { id: '1', value: 'evidence', annotations: {} };
              })();
        const run = async () => {
          const result = await executeAction(
            semanticCommands[command].actions.run,
            input,
            { instruction: 'extract', schema: path },
            {},
            ctx,
          );

          return command === 'extract' ? result : Array.fromAsync(result as AsyncIterable<unknown>);
        };

        try {
          if (repaired)
            expect(await run()).toEqual(
              command === 'extract' ? 'long' : [{ id: '1', value: 'long', annotations: { map: { originId: '1' } } }],
            );
          else await expect(run()).rejects.toMatchObject({ code: 4 });
          expect(calls).toBe(2);
          expect(llm.repairs).toBe(1);
        } finally {
          budget.close();
        }
      }
    await writeFile(path, JSON.stringify({ ...schema, oneOf: [{ const: 'x' }] }));
    for (const command of ['extract', 'map'] as const) {
      const budget = new Budget();
      const ctx: Context = {
        budget,
        signal: budget.signal,
        log() {},
        llm: {
          async text() {
            throw new Error('Unexpected inference');
          },
          async object() {
            throw new Error('Unexpected inference');
          },
        },
      };

      try {
        const result = executeAction(
          semanticCommands[command].actions.run,
          command === 'extract' ? 'evidence' : (async function* () {})(),
          { instruction: 'extract', schema: path },
          {},
          ctx,
        );

        await expect(
          (async () => {
            const output = await result;

            if (command === 'map') await Array.fromAsync(output as AsyncIterable<unknown>);
          })(),
        ).rejects.toMatchObject({ code: 2 });
        expect(budget.requests).toBe(0);
      } finally {
        budget.close();
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
