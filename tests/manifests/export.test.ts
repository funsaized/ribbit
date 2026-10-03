import { test, expect } from 'bun:test';
import { z, defineAction, defineCommand, recordSchema } from '../../src/sdk/index.ts';
import { manifest, hash, stable, schemaToJson } from '../../src/sdk/manifest/index.ts';

const config = z.strictObject({});

function command(
  args = z.strictObject({
    nested: z.strictObject({ answer: z.string() }),
    maxWords: z.number().default(3),
    rules: z.array(z.string()).optional(),
  }),
) {
  return defineCommand({
    type: '@test/export',
    version: '1.0.0',
    description: 'test',
    config,
    actions: {
      run: defineAction({
        config,
        args,
        input: z.string(),
        output: z.string(),
        mode: 'value',
        description: 'run',
        capabilities: [],
        effects: [],
        execute: ({ input }) => input,
      }),
    },
  });
}

test('one deterministic manifest contains nested schemas and generated flags', () => {
  const a = manifest(command(), hash('source'));

  expect(stable(a)).toBe(stable(manifest(command(), hash('source'))));
  expect(a.actions.run.bindings.find((b) => b.field === 'maxWords')?.flag).toBe('max-words');
  expect(a.actions.run.args.properties.nested.properties.answer.type).toBe('string');
  expect(a.actions.run.bindings.find((b) => b.field === 'rules')?.repeated).toBe(true);
  expect(a.sourceHash).not.toBe(manifest(command(), hash('changed')).sourceHash);
});
test('reserved flag and runtime code transforms/refinements fail export', () => {
  expect(() => manifest(command(z.strictObject({ model: z.string() }) as never), hash('x'))).toThrow('Reserved');
  for (const bad of [
    z.string().transform((x) => x.length),
    z.string().refine((x) => !!x),
    z.lazy(() => z.string()),
    z.date(),
    z.any(),
    z.unknown(),
  ])
    expect(() => schemaToJson(bad)).toThrow();
});
test('conditional capabilities survive export and invalid selectors fail export', () => {
  const base = command();
  const conditional = {
    ...base,
    actions: {
      run: {
        ...base.actions.run,
        args: z.strictObject({ schema: z.string().optional() }),
        capabilities: { whenAny: ['schema'], ifTrue: ['object'], ifFalse: ['text'] },
      },
    },
  };

  expect(manifest(conditional, hash('source')).actions.run.capabilities).toEqual(conditional.actions.run.capabilities);
  conditional.actions.run.capabilities.whenAny = ['missing'];
  expect(() => manifest(conditional, hash('source'))).toThrow('Capability selector missing');
});

test('record envelopes export JSON value and annotation contracts', () => {
  const schema = schemaToJson(recordSchema) as any;

  expect(schema.type).toBe('object');
  expect(schema.additionalProperties).toBe(false);
});
