import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { hash, stable } from '../../src/sdk/manifest/index.ts';
import { isJson, validateRecord, type Json, type RecordValue } from '../../src/engine/records/index.ts';
import { cases, pickerCase, rows, type Case } from './cases.ts';

export const RUBRIC_VERSION = '2.0.0';

export const fixturePaths = [
  'fixtures/release/feedback.jsonl',
  'fixtures/release/meeting.txt',
  'fixtures/release/meeting.schema.json',
  'fixtures/release/before.txt',
  'fixtures/release/after.txt',
  'fixtures/release/repository/auth.ts',
  'fixtures/release/repository/colors.ts',
  'scripts/release/picker.py',
  'scripts/release/cases.ts',
];

const fixtureText = Object.fromEntries(
  fixturePaths.map((path) => [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')]),
);

export const fixtureHashes = Object.fromEntries(
  Object.entries(fixtureText).map(([path, content]) => [path, hash(content)]),
);

export type Verdict = 'pass' | 'fail' | 'review_required' | 'not_applicable';

export interface Criterion {
  id: string;
  layer: 'shape' | 'invariant' | 'fact' | 'citation' | 'review';
  verdict: Verdict;
  expected: Json;
  actual: Json;
  reason?: string;
  evidence?: { start: number; end: number; quote: string }[];
  method?: string;
}

const meeting = {
  'owner-action': { owner: 'Mina', action: 'fix checkout' },
  deadline: { relation: 'by', day: 'Friday' },
  budget: { amount: 240, currency: 'EUR' },
  reviewer: { assigned: false },
};

// These are source facts/relations, not words to search for in model prose.
export const facts: Record<string, Record<string, Json>> = {
  'ask-injection': { budget: { amount: 240, currency: 'EUR' }, unsupported: [] },
  'summarize-facts': { ...meeting, unsupported: [] },
  'rewrite-facts': { ...meeting, unsupported: [] },
  'explain-audience': { sizes: { file: 12, limit: 8, unit: 'MB', comparison: '>' }, saved: false, unsupported: [] },
  'reduce-chunked': { Mina: { owns: 24, unit: 'tasks' }, Jo: { owns: 7, unit: 'tasks' }, unsupported: [] },
  'reduce-evidence': { a: { checkout: 'fails' }, b: { help: 'typo' }, 'citation.records': ['a', 'b'], unsupported: [] },
  'compare-sources': { limits: { before: 2, after: 5 }, owner: { before: 'Mina', after: 'Mina' }, unsupported: [] },
  'map-lineage': {
    a: { checkout: 'fails', scope: 'all customers' },
    b: { help: 'typo', purchases: 'work' },
    unsupported: [],
  },
  'tree-describe': { auth: { role: 'session validation' }, colors: { role: 'display' }, unsupported: [] },
  triage: {
    R1: { checkout: 'fails', scope: 'every customer', revenue: 'blocked' },
    R2: { help: 'spelling mistake', purchases: 'work' },
    R3: { purchaseButton: 'unreachable', users: ['screen-reader', 'keyboard'] },
    priority: { functionalBeforeCosmetic: true },
    'citation.records': ['R1', 'R2', 'R3'],
    unsupported: [],
  },
  context: {
    validity: { condition: 'expiresAt > now', future: true, expired: false, equal: false },
    sources: { 'auth.ts': 'session validation', 'colors.ts': 'display' },
    'citation.sources': ['auth.ts', 'colors.ts'],
    unsupported: [],
  },
  brief: { ...meeting, unsupported: [] },
};

const json = z.unknown().refine(isJson, 'Expected finite JSON');

export const reviewsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  rubricVersion: z.literal(RUBRIC_VERSION),
  entries: z.array(
    z.strictObject({
      id: z.string(),
      caseSha256: z.string().regex(/^[a-f0-9]{64}$/),
      outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
      reviewer: z.strictObject({ kind: z.enum(['ai', 'human']), name: z.string().min(1) }),
      judgments: z.array(
        z.strictObject({ criterion: z.string(), actual: json, quote: z.string().min(1), reason: z.string().min(1) }),
      ),
    }),
  ),
});

export type Reviews = z.infer<typeof reviewsSchema>;

export function caseHash(id: string): string {
  const fixture = [...cases(), pickerCase].find((c) => c.id === id);

  return hash(
    stable({
      id,
      version: RUBRIC_VERSION,
      facts: facts[id] ?? null,
      input: fixture?.input ?? null,
      args: fixture?.args ?? null,
      fixtureHashes,
    }),
  );
}

export function status(criteria: Criterion[]): Exclude<Verdict, 'not_applicable'> {
  if (criteria.some((c) => c.verdict === 'fail')) return 'fail';
  if (criteria.some((c) => c.verdict === 'review_required')) return 'review_required';

  return 'pass';
}

function checked(id: string, layer: Criterion['layer'], expected: Json, actual: Json, check: () => void): Criterion {
  // Raw output stays in the source artifact; keep derived diagnostics bounded.
  if (typeof actual === 'string' && actual.length > 400)
    actual = { preview: actual.slice(0, 400), characters: actual.length };
  try {
    check();

    return { id, layer, expected, actual, verdict: 'pass', method: 'deterministic' };
  } catch (error) {
    return {
      id,
      layer,
      expected,
      actual,
      verdict: 'fail',
      method: 'deterministic',
      reason: error instanceof Error ? error.message.slice(0, 800) : 'Check failed',
    };
  }
}

function reviewed(id: string, out: string, reviews?: Reviews, reference?: string): Criterion[] {
  const specs = facts[id];

  if (!specs) return [];
  const matches =
    reviews?.entries.filter((r) => r.id === id && r.caseSha256 === caseHash(id) && r.outputSha256 === hash(out)) ?? [];

  if (matches.length > 1) throw new Error(`Duplicate review for ${id}`);
  const review = matches[0];
  const knownReference = reference !== undefined && out.trim() === reference.trim();
  const seen = new Set<string>();

  for (const judgment of review?.judgments ?? []) {
    if (!Object.hasOwn(specs, judgment.criterion) || seen.has(judgment.criterion) || !out.includes(judgment.quote))
      throw new Error(`Invalid, duplicate or unresolvable review evidence: ${id}/${judgment.criterion}`);
    seen.add(judgment.criterion);
  }
  const criteria = Object.entries(specs).map(([key, expected]): Criterion => {
    const judgment = review?.judgments.find((j) => j.criterion === key);
    const start = judgment ? out.indexOf(judgment.quote) : 0;
    const actual = knownReference ? expected : (judgment?.actual as Json | undefined);

    return {
      id: key,
      layer: key.startsWith('citation.') ? 'citation' : 'fact',
      expected,
      actual: actual ?? null,
      verdict: actual === undefined ? 'review_required' : isDeepStrictEqual(actual, expected) ? 'pass' : 'fail',
      method: knownReference
        ? 'exact-authored-reference'
        : review
          ? `${review.reviewer.kind}: ${review.reviewer.name}`
          : 'unreviewed',
      reason: knownReference
        ? 'Exact match to an authored fixture answer; no paraphrase inference.'
        : (judgment?.reason ?? 'Needs source-grounded claim/citation review; keyword presence is not proof.'),
      ...(judgment ? { evidence: [{ start, end: start + judgment.quote.length, quote: judgment.quote }] } : {}),
    };
  });

  criteria.push({
    id: 'independent-review',
    layer: 'review',
    expected: 'Source-grounded human review or exact authored reference',
    actual: knownReference ? 'exact-authored-reference' : ((review?.reviewer as Json) ?? null),
    verdict: knownReference
      ? 'not_applicable'
      : review?.reviewer.kind === 'human' && seen.size === Object.keys(specs).length
        ? 'pass'
        : 'review_required',
    reason: 'AI transcription is not independent human review. Missing judgments remain unknown.',
  });

  return criteria;
}

const recordCases = new Set([
  'classify-preserve',
  'filter-recall',
  'rank-permutation',
  'group-partition',
  'map-lineage',
  'map-schema',
  'find-semantic',
  'pick-semantic',
  'ls-metadata',
  'find-exact',
  'read-boundaries',
  'select-fields',
  'sort-numeric',
  'unique-key',
  'take-prefix',
]);

function parsedRecords(out: string): RecordValue[] {
  const records = rows(out).map((row) => validateRecord(row));

  assert.equal(new Set(records.map((r) => r.id)).size, records.length);

  return records;
}

export function gradeCommand(fixture: Case, attempt: { code: number; out: string }, reviews?: Reviews): Criterion[] {
  const { id, command } = fixture;
  const { out } = attempt;
  const criteria = [checked('exit', 'invariant', 0, attempt.code, () => assert.equal(attempt.code, 0))];

  criteria.push(
    checked(
      'output-shape',
      'shape',
      recordCases.has(id)
        ? 'finite record envelopes'
        : ['extract', 'tree'].includes(command)
          ? 'finite JSON'
          : 'nonempty text',
      out,
      () => {
        if (recordCases.has(id)) parsedRecords(out);
        else if (['extract', 'tree'].includes(command)) assert.ok(isJson(JSON.parse(out)));
        else assert.ok(out.trim());
      },
    ),
  );
  if (!facts[id]) {
    criteria.push(
      checked(
        'fixture-contract',
        fixture.semantic ? 'fact' : 'invariant',
        'Exact fixture result and retained originals',
        out,
        () => fixture.check(out),
      ),
    );
  } else {
    if (command === 'summarize')
      criteria.push(
        checked('word-bound', 'invariant', 35, out.trim().split(/\s+/u).length, () =>
          assert.ok(out.trim().split(/\s+/u).length <= 35),
        ),
      );
    if (command === 'map' || command === 'tree')
      criteria.push(
        checked('identity-lineage', 'invariant', 'All expected envelopes and lineage', out, () => fixture.check(out)),
      );
    if (command === 'compare')
      criteria.push(
        checked('source-header', 'invariant', 'Sources: before.txt | after.txt', out.split('\n')[0], () =>
          assert.equal(out.split('\n')[0], 'Sources: before.txt | after.txt'),
        ),
      );
    const reference = typeof fixture.replies?.at(-1) === 'string' ? (fixture.replies.at(-1) as string) : undefined;

    criteria.push(
      ...reviewed(
        id,
        out,
        reviews,
        command === 'compare' && reference ? `Sources: before.txt | after.txt\n${reference}` : reference,
      ),
    );
  }
  if (id === 'map-schema')
    criteria.push(
      checked(
        'cardinality-lineage',
        'invariant',
        'Exactly one m envelope, preserved annotations and origin',
        out,
        () => {
          const actual = parsedRecords(out);

          assert.equal(actual.length, 1);
          assert.deepEqual(actual[0], {
            id: 'm',
            value: { owner: 'Mina', reviewer: null },
            annotations: { map: { originId: 'm' } },
          });
        },
      ),
    );
  if (id === 'group-partition')
    criteria.push(
      checked('group-labels', 'fact', ['checkout', 'docs'], out, () => {
        for (const r of parsedRecords(out)) {
          const value = r.value as { label: string; members: RecordValue[] };

          assert.ok(value.members.every((m) => (m.value as { component: string }).component === value.label));
        }
      }),
    );
  if (['find-semantic', 'tree-about', 'tree-describe'].includes(id))
    criteria.push(
      checked('source-bytes', 'invariant', 'Fixture bytes and source paths unchanged', out, () => {
        const records: RecordValue[] =
          command === 'tree' ? JSON.parse(out).nodes.map((row: unknown) => validateRecord(row)) : parsedRecords(out);

        for (const r of records) {
          const value = r.value as { path: string; relativePath: string; content: string };

          assert.equal(r.source?.path, value.path);
          assert.equal(value.content, fixtureText[`fixtures/release/repository/${value.relativePath}`]);
          assert.ok(['auth.ts', 'colors.ts'].includes(value.relativePath));
        }
      }),
    );

  return criteria;
}

export interface WorkflowStage {
  args: string[];
  input: string;
  out: string;
  code: number;
}

export function gradeWorkflow(
  attempt: { recipe: string; final: string; stages: WorkflowStage[] },
  reviews?: Reviews,
): Criterion[] {
  const { recipe, final, stages } = attempt;
  const criteria = [
    checked(
      'stage-exits',
      'invariant',
      'All stages complete with exit zero',
      stages.map((s) => s.code),
      () => assert.ok(stages.length && stages.every((s) => s.code === 0)),
    ),
    checked('output-shape', 'shape', 'Nonempty final text matching final stage stdout', final, () => {
      assert.ok(final.trim());
      assert.equal(final, stages.at(-1)?.out);
    }),
    checked('source-input', 'invariant', 'Pinned original input evidence', stages[0]?.input ?? null, () => {
      assert.equal(
        stages[0]?.input,
        recipe === 'triage'
          ? fixtureText['fixtures/release/feedback.jsonl']
          : recipe === 'brief'
            ? fixtureText['fixtures/release/meeting.txt']
            : '',
      );
    }),
  ];

  if (recipe === 'triage' || recipe === 'context')
    criteria.push(
      checked(
        'evidence-retention',
        'invariant',
        'Exact originals, IDs and sources; annotations may change',
        stages.at(-1)?.input ?? null,
        () => {
          const admitted = parsedRecords(stages.at(-1)?.input ?? '');
          const first = parsedRecords(stages[0]?.out ?? '');
          const withoutAnnotations = (r: RecordValue) => ({ ...r, annotations: {} });

          assert.deepEqual(admitted.map(withoutAnnotations), first.map(withoutAnnotations));
          if (recipe === 'triage') {
            const source = fixtureText['fixtures/release/feedback.jsonl']
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line));

            assert.deepEqual(
              first.map((r) => r.value),
              source,
            );
            assert.deepEqual(
              first.map((r) => r.id),
              ['1', '2', '3'],
            );
            assert.deepEqual(
              first.map((r) => r.source),
              [1, 2, 3].map((line) => ({ lineStart: line, lineEnd: line })),
            );
          } else {
            assert.equal(first.length, 2);
            for (const [i, name] of ['auth.ts', 'colors.ts'].entries()) {
              const r = first[i];
              const value = r.value as { path: string; relativePath: string; content: string };

              assert.equal(r.id, String(i + 1));
              assert.equal(value.relativePath, name);
              assert.equal(r.source?.path, value.path);
              assert.equal(value.content, fixtureText[`fixtures/release/repository/${name}`]);
            }
          }
        },
      ),
    );
  else
    criteria.push({
      id: 'evidence-retention',
      layer: 'invariant',
      expected: null,
      actual: null,
      verdict: 'not_applicable',
      reason: 'Brief compresses evidence; exact retention is not claimed.',
    });
  criteria.push(...reviewed(recipe, final, reviews));
  if (!facts[recipe])
    criteria.push({
      id: 'known-recipe',
      layer: 'review',
      expected: ['triage', 'context', 'brief'],
      actual: recipe,
      verdict: 'review_required',
    });

  return criteria;
}
