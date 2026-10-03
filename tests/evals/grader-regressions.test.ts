import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { regrade } from '../../scripts/release/regrade.ts';
import { cases, originals, pickerCase, wire } from '../../scripts/release/cases.ts';
import { RUBRIC_VERSION, caseHash, facts, gradeCommand, status, type Reviews } from '../../scripts/release/rubric.ts';
import { hash } from '../../src/sdk/manifest/index.ts';
import type { Json } from '../../src/engine/records/index.ts';

const fixture = (id: string) => [...cases(), pickerCase].find((c) => c.id === id)!;
const grade = (id: string, out: string, reviews?: Reviews) => gradeCommand(fixture(id), { code: 0, out }, reviews);

function review(id: string, out: string): Reviews {
  return {
    schemaVersion: 1,
    rubricVersion: RUBRIC_VERSION,
    entries: [
      {
        id,
        caseSha256: caseHash(id),
        outputSha256: hash(out),
        reviewer: { kind: 'human', name: 'test-only fictional reviewer' },
        judgments: Object.entries(facts[id]).map(([criterion, actual]) => ({
          criterion,
          actual,
          quote: out,
          reason: 'Test-authored judgment of this complete synthetic output.',
        })),
      },
    ],
  };
}

function fileRecord(name: 'auth.ts' | 'colors.ts') {
  const content = readFileSync(`fixtures/release/repository/${name}`, 'utf8');
  const annotations: Record<string, Json> = {};

  return {
    id: name === 'auth.ts' ? '1' : '2',
    value: {
      path: `/fixture/repository/${name}`,
      relativePath: name,
      kind: 'file',
      sizeBytes: Buffer.byteLength(content),
      modifiedAt: '2026-10-03T00:00:00.000Z',
      content,
    },
    source: { path: `/fixture/repository/${name}` },
    annotations,
  };
}

test('replay distinguishes absent, null, matching and mismatched task provenance', () => {
  const c = fixture('extract-missing');
  const base = { id: c.id, code: 0, repetition: 1, out: '{"owner":"Mina","reviewer":null}' };
  const variants = [
    { metadata: {}, verdict: 'review_required' },
    { metadata: { args: c.args }, verdict: 'review_required' },
    { metadata: { input: c.input }, verdict: 'review_required' },
    { metadata: { input: null, args: c.args }, verdict: 'fail' },
    { metadata: { input: c.input, args: c.args }, verdict: 'pass' },
    { metadata: { input: 'Jo owns the task.', args: c.args }, verdict: 'fail' },
    { metadata: { input: c.input, args: [] }, verdict: 'fail' },
    { metadata: { args: ['Different task'] }, verdict: 'fail' },
    { metadata: { input: 'Jo owns the task.' }, verdict: 'fail' },
  ] as const;

  for (const schemaVersion of [1, 2])
    for (const { metadata, verdict } of variants) {
      const result = regrade(JSON.stringify({ schemaVersion, attempts: [{ ...base, ...metadata }] }));

      expect(result.attempts[0].status).toBe(verdict);
      expect(result.attempts[0].criteria.find((criterion) => criterion.id === 'fixture-match')?.verdict).toBe(verdict);
    }
  expect(() =>
    regrade(JSON.stringify({ schemaVersion: 1, attempts: [{ ...base, input: c.input, args: null }] })),
  ).toThrow();
  // No-stdin cases declare null explicitly; an omitted field leaves the task unknown.
  const out = wire([fileRecord('auth.ts')]);
  const fileAttempt = { id: 'find-semantic', code: 0, repetition: 1, out, args: fixture('find-semantic').args };

  expect(regrade(JSON.stringify({ schemaVersion: 1, attempts: [{ ...fileAttempt, input: null }] })).status).toBe(
    'pass',
  );
  expect(regrade(JSON.stringify({ schemaVersion: 1, attempts: [fileAttempt] })).status).toBe('review_required');
});

test('semantic picker must return the complete original selected envelope', () => {
  const value: { ticket: string; body: string; component: string } = JSON.parse(
    readFileSync('fixtures/release/feedback.jsonl', 'utf8').split('\n')[0],
  );
  const original = { id: '1', value, source: { path: 'feedback.jsonl', lineStart: 1, lineEnd: 1 }, annotations: {} };

  expect(status(grade('pick-semantic', wire([original])))).toBe('pass');
  for (const field of ['id', 'source', 'body', 'annotations']) {
    const record = structuredClone(original);

    if (field === 'id') record.id = 'invented';
    if (field === 'source') record.source.path = 'invented.txt';
    if (field === 'body') record.value.body = 'Purchases work';
    const annotations = field === 'annotations' ? { invented: true } : record.annotations;

    expect(status(grade('pick-semantic', wire([{ ...record, annotations }])))).toBe('fail');
  }
});

test('classification must retain supplied annotations as well as IDs, sources and values', () => {
  const records = structuredClone(originals).map((record, i) => ({
    ...record,
    annotations: { ...record.annotations, classify: { label: ['blocking', 'cosmetic'][i] } },
  }));

  expect(status(grade('classify-preserve', wire(records)))).toBe('pass');
  for (const field of ['missing-annotation', 'changed-annotation', 'id', 'source', 'body']) {
    const changed = structuredClone(records);

    if (field === 'missing-annotation') delete changed[0].annotations.supplied;
    if (field === 'changed-annotation') changed[0].annotations.supplied = false;
    if (field === 'id') changed[0].id = 'invented';
    if (field === 'source') changed[0].source.path = 'invented.txt';
    if (field === 'body') changed[0].value.body = 'Purchases work';
    expect(status(grade('classify-preserve', wire(changed)))).toBe('fail');
  }
});

test('filesystem selection binds stable IDs, source envelopes, bytes and annotations', () => {
  for (const id of ['find-semantic', 'tree-about']) {
    const serialize = (record: ReturnType<typeof fileRecord>) =>
      id === 'find-semantic'
        ? wire([record])
        : JSON.stringify({ root: '/fixture/repository', evidence: 'metadata', nodes: [record] });

    expect(status(grade(id, serialize(fileRecord('auth.ts'))))).toBe('pass');
    for (const field of ['id', 'source', 'content', 'annotations', 'kind', 'size']) {
      const record = fileRecord('auth.ts');

      if (field === 'id') record.id = 'invented';
      if (field === 'source') record.source.path = 'invented.txt';
      if (field === 'content') record.value.content = 'Purchases work';
      if (field === 'annotations') record.annotations.invented = true;
      if (field === 'kind') record.value.kind = 'directory';
      if (field === 'size') record.value.sizeBytes++;
      expect(status(grade(id, serialize(record)))).toBe('fail');
    }
  }
});

test('accurate map paraphrases pass identity/lineage, while meaning still requires review', () => {
  const records = originals.map((record, i) => ({
    ...record,
    value: [
      'Every customer is unable to complete a purchase',
      'The help text has a spelling error; buying still succeeds',
    ][i],
    annotations: { ...record.annotations, map: { originId: record.id } },
  }));
  const out = wire(records);
  const criteria = grade('map-lineage', out);

  expect(criteria.find((criterion) => criterion.id === 'identity-lineage')?.verdict).toBe('pass');
  expect(status(criteria)).toBe('review_required');
  expect(status(grade('map-lineage', out, review('map-lineage', out)))).toBe('pass');
  for (const field of ['id', 'source', 'annotation', 'lineage']) {
    const changed = structuredClone(records);

    if (field === 'id') changed[0].id = 'invented';
    if (field === 'source') changed[0].source.path = 'invented.txt';
    if (field === 'annotation') delete changed[0].annotations.supplied;
    if (field === 'lineage') changed[0].annotations.map.originId = 'invented';
    const changedOut = wire(changed);

    expect(status(grade('map-lineage', changedOut, review('map-lineage', changedOut)))).toBe('fail');
  }
  records[0].value = 'Every customer can complete a purchase';
  const contradiction = wire(records);
  const judgments = review('map-lineage', contradiction);

  judgments.entries[0].judgments.find((judgment) => judgment.criterion === 'a')!.actual = {
    checkout: 'works',
    scope: 'all customers',
  };
  const rejected = grade('map-lineage', contradiction, judgments);

  expect(rejected.find((criterion) => criterion.id === 'identity-lineage')?.verdict).toBe('pass');
  expect(rejected.find((criterion) => criterion.id === 'a')?.verdict).toBe('fail');
});

test('accurate tree paraphrases are reviewed independently of identity/lineage', () => {
  const nodes = [fileRecord('auth.ts'), fileRecord('colors.ts')];

  nodes[0].annotations.tree = {
    description: 'Reports whether an expiration timestamp is later than the current timestamp.',
    evidence: 'content',
  };
  nodes[1].annotations.tree = { description: 'Exports blue for the navigation header.', evidence: 'content' };
  const serialize = () => JSON.stringify({ root: '/fixture/repository', evidence: 'content', nodes });
  const out = serialize();
  const criteria = grade('tree-describe', out);

  expect(criteria.find((criterion) => criterion.id === 'identity-lineage')?.verdict).toBe('pass');
  expect(status(criteria)).toBe('review_required');
  expect(status(grade('tree-describe', out, review('tree-describe', out)))).toBe('pass');
  nodes[0].annotations.tree = { description: 'Sets navigation-header appearance.', evidence: 'content' };
  const contradiction = serialize();
  const judgments = review('tree-describe', contradiction);

  judgments.entries[0].judgments.find((judgment) => judgment.criterion === 'auth')!.actual = { role: 'display' };
  const rejected = grade('tree-describe', contradiction, judgments);

  expect(rejected.find((criterion) => criterion.id === 'identity-lineage')?.verdict).toBe('pass');
  expect(rejected.find((criterion) => criterion.id === 'auth')?.verdict).toBe('fail');
});
