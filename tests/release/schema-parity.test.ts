import { test, expect } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockProvider, sandbox, parseStats } from '../../scripts/release/harness.ts';

// JSON string replies must include quotes: bare x would only test JSON parsing.
test('packaged extraction enforces enum/const/anyOf siblings before accepting a reply', async () => {
  const provider = mockProvider();
  const env = await sandbox(provider.config);

  try {
    for (const schema of [
      { type: 'string', enum: ['x'], minLength: 10 },
      { type: 'string', const: 'x', minLength: 10 },
      { type: 'string', anyOf: [{ const: 'x' }], minLength: 10 },
    ]) {
      await writeFile(join(env.dir, 'schema.json'), JSON.stringify(schema));
      provider.reset(['"x"', '"x"']);
      const result = await env.run(['extract', 'Extract x', '--schema', 'schema.json', '--stats'], 'x');

      expect(result.code, result.err).toBe(4);
      expect(result.out).toBe('');
      expect(provider.requests).toHaveLength(2);
      expect(parseStats(result.err)?.repairs).toBe(1);
      expect(provider.requests[0].response_format.json_schema.schema).toEqual(schema);
    }
    const schema = { type: ['string', 'null'], enum: ['x', 'long', null], minLength: 3 };

    await writeFile(join(env.dir, 'schema.json'), JSON.stringify(schema));
    provider.reset(['"x"', '"long"']);
    const repaired = await env.run(['extract', 'Extract', '--schema', 'schema.json', '--stats'], 'long');

    expect(repaired.code, repaired.err).toBe(0);
    expect(JSON.parse(repaired.out)).toBe('long');
    expect(parseStats(repaired.err)?.repairs).toBe(1);
    await writeFile(join(env.dir, 'schema.json'), JSON.stringify({ ...schema, oneOf: [{ const: 'x' }] }));
    provider.reset([]);
    const unsupported = await env.run(['extract', 'Extract', '--schema', 'schema.json'], 'x');

    expect(unsupported.code).toBe(2);
    expect(provider.requests).toHaveLength(0);
  } finally {
    await env.close();
    provider.close();
  }
}, 15000);
