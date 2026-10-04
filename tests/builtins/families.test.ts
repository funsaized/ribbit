import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { builtins } from '../../src/builtins/index.ts';
import { executeAction, Budget, type Context } from '../../src/sdk/index.ts';

async function invoke(name: keyof typeof builtins, input: unknown, args: unknown, responses: unknown[] = []) {
  const budget = new Budget();
  let calls = 0;
  const ctx: Context = {
    budget,
    signal: budget.signal,
    log() {},
    llm: {
      async text() {
        return String(responses[calls++]);
      },
      async object(_i, _e, s) {
        return s.parse(responses[calls++]);
      },
    },
  };

  try {
    let value = await executeAction(builtins[name].actions.run, input, args, {}, ctx);

    if (value && typeof (value as any)[Symbol.asyncIterator] === 'function')
      value = await Array.fromAsync(value as AsyncIterable<unknown>);

    return { value, calls };
  } finally {
    budget.close();
  }
}

async function* records() {
  yield { id: 'a', value: 'first', annotations: { original: true } };
  yield { id: 'b', value: 'second', annotations: {} };
}

test('text families and classification retain declared behavior', async () => {
  for (const name of ['ask', 'explain', 'rewrite'] as const)
    expect((await invoke(name, 'evidence', name === 'explain' ? {} : { instruction: 'test' }, ['answer'])).value).toBe(
      'answer',
    );
  const classified = await invoke('classify', records(), { labels: 'yes,no' }, [
    { reason: 'positive', label: 'yes' },
    { reason: 'negative', label: 'no' },
  ]);

  expect(classified.value).toMatchObject([
    { id: 'a', value: 'first', annotations: { original: true, classify: { label: 'yes' } } },
    { id: 'b', value: 'second', annotations: { classify: { label: 'no' } } },
  ]);
  await expect(
    invoke('classify', records(), { labels: 'yes,no' }, [{ reason: 'unsure', label: 'invented' }]),
  ).rejects.toBeDefined();
});
test('group requires a complete partition and reduce reports actual calls', async () => {
  const result = await invoke('group', records(), { instruction: 'group' }, [
    { groups: [{ label: 'both', ids: ['b', 'a'] }] },
  ]);

  expect(result.value).toMatchObject([{ value: { members: [{ id: 'b' }, { id: 'a' }] } }]);
  await expect(
    invoke('group', records(), { instruction: 'group' }, [{ groups: [{ label: 'partial', ids: ['a'] }] }]),
  ).rejects.toMatchObject({ code: 4 });
  const reduced = await invoke('reduce', 'abcdef', { instruction: 'summarize', strategy: 'chunked', chunkBytes: 3 }, [
    'abc summary',
    'def summary',
    'combined',
  ]);

  expect(reduced).toEqual({ value: 'combined', calls: 3 });
});
test('schema extraction retains declared behavior', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-families-'));

  try {
    const schema = join(dir, 'schema.json');

    await writeFile(
      schema,
      JSON.stringify({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      }),
    );
    expect(
      (await invoke('extract', 'A title', { instruction: 'extract', schema }, [{ title: 'A title' }])).value,
    ).toEqual({ title: 'A title' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('explicit file comparison identifies both sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-families-'));

  try {
    const a = join(dir, 'a.txt'),
      b = join(dir, 'b.txt');

    await writeFile(a, 'before');
    await writeFile(b, 'after');
    expect((await invoke('compare', null, { paths: [a, b] }, ['changed'])).value).toContain(`Sources: ${a} | ${b}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('safe templates support record-envelope addressing only for records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-families-'));

  try {
    const template = join(dir, 'template.txt');

    await writeFile(template, 'Title: {{title}} $(touch NEVER)');
    expect((await invoke('render', { title: 'Data' }, { template })).value).toBe('Title: Data $(touch NEVER)');
    await writeFile(template, '{{constructor}}');
    await expect(invoke('render', { title: 'Data' }, { template })).rejects.toMatchObject({ code: 2 });
    await writeFile(template, '{{$.id}}: {{title}} ({{$.source.path}})');
    const record = { id: 'r1', value: { title: 'Data' }, source: { path: 'evidence.txt' }, annotations: {} };
    const budget = new Budget();

    try {
      const context: Context = {
        budget,
        signal: budget.signal,
        inputKind: 'records',
        log() {},
        llm: {
          async text() {
            throw new Error('No model');
          },
          async object() {
            throw new Error('No model');
          },
        },
      };

      expect(await executeAction(builtins.render.actions.run, [record], { template }, {}, context)).toBe(
        'r1: Data (evidence.txt)',
      );
    } finally {
      budget.close();
    }
    await expect(invoke('render', { title: 'Data' }, { template })).rejects.toMatchObject({ code: 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
