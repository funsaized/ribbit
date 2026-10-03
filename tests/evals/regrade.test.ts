import { test, expect } from 'bun:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { regrade } from '../../scripts/release/regrade.ts';
import {
  RUBRIC_VERSION,
  caseHash,
  gradeCommand,
  facts,
  gradeWorkflow,
  reviewsSchema,
  status,
  type Reviews,
} from '../../scripts/release/rubric.ts';
import { cases, wire } from '../../scripts/release/cases.ts';
import { hash } from '../../src/sdk/manifest/index.ts';
import reviewsFile from '../../fixtures/evals/control-reviews.json';
import controls from '../../fixtures/evals/contradictions.json';

const reviews = reviewsSchema.parse(reviewsFile);
const fixture = (id: string) => cases().find((c) => c.id === id)!;

function failure(criteria: ReturnType<typeof gradeCommand>, id: string) {
  expect(criteria.find((c) => c.id === id)?.verdict).toBe('fail');
}

test('all six audit contradictions pass the historical floor but fail source-fact/citation criteria', () => {
  for (const control of controls) {
    fixture(control.id).check(control.out);
    const criteria = gradeCommand(fixture(control.id), { code: 0, out: control.out }, reviews);

    expect(status(criteria)).toBe('fail');
    for (const id of control.failed) failure(criteria, id);
    expect(criteria.find((c) => c.id === 'output-shape')?.verdict).toBe('pass');
  }
});

test('correct authored prose references pass without interpreting arbitrary paraphrases', () => {
  for (const id of [
    'ask-grounded',
    'ask-injection',
    'summarize-facts',
    'rewrite-facts',
    'explain-audience',
    'reduce-evidence',
    'reduce-chunked',
    'compare-sources',
  ]) {
    const c = fixture(id);
    const reply = String(c.replies?.at(-1));
    const out = id === 'compare-sources' ? `Sources: before.txt | after.txt\n${reply}\n` : reply + '\n';

    expect(status(gradeCommand(c, { code: 0, out }))).toBe('pass');
  }
  expect(status(gradeCommand(fixture('summarize-facts'), { code: 0, out: 'Mina Friday 240' }))).toBe('review_required');
});

test('replay grades a synthetic transcript without mutating its source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-regrade-source-'));

  try {
    const raw = JSON.stringify({
      schemaVersion: 2,
      pass: false,
      attempts: ['ask-grounded', controls[0].id, 'extract-missing'].map((id) => {
        const c = fixture(id);

        return {
          id,
          code: 0,
          repetition: 1,
          input: c.input,
          args: c.args,
          out:
            id === controls[0].id
              ? controls[0].out
              : id === 'ask-grounded'
                ? 'Mina\n'
                : '{"owner":"Mina","reviewer":null}\n',
        };
      }),
    });
    const path = join(dir, 'report.json');

    await writeFile(path, raw);
    const report = regrade(await readFile(path, 'utf8'), reviews);

    expect(report.sourceReportSha256).toBe(hash(raw));
    expect(report.rubricVersion).toBe(RUBRIC_VERSION);
    expect(report.sourceCompletion).toBe('complete');
    expect(report.summary).toEqual({ pass: 2, fail: 1, review_required: 0 });
    failure(report.attempts[1].criteria, 'owner-action');
    expect(await readFile(path, 'utf8')).toBe(raw);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AI fact transcriptions do not satisfy independent human review', () => {
  const id = 'explain-audience';
  const out = 'A 12 MB file cannot fit under the 8 MB limit and was not saved.';
  const doc: Reviews = {
    schemaVersion: 1,
    rubricVersion: RUBRIC_VERSION,
    entries: [
      {
        id,
        caseSha256: caseHash(id),
        outputSha256: hash(out),
        reviewer: { kind: 'ai', name: 'test-only fictional reviewer' },
        judgments: Object.entries(facts[id]).map(([criterion, actual]) => ({
          criterion,
          actual,
          quote: out,
          reason: 'Test-authored transcription of this complete fixture answer.',
        })),
      },
    ],
  };
  const criteria = gradeCommand(fixture(id), { code: 0, out }, doc);

  expect(criteria.filter((c) => c.layer === 'fact').every((c) => c.verdict === 'pass')).toBe(true);
  expect(status(criteria)).toBe('review_required');
  doc.entries[0].reviewer.kind = 'human';
  expect(status(gradeCommand(fixture(id), { code: 0, out }, doc))).toBe('pass');
});

test('retention checks bytes and identity, not nonempty content or substring matches', async () => {
  for (const recipe of ['triage', 'context']) {
    const source = recipe === 'triage' ? await readFile('fixtures/release/feedback.jsonl', 'utf8') : '';
    const records =
      recipe === 'triage'
        ? source
            .trim()
            .split('\n')
            .map((line, i) => ({
              id: String(i + 1),
              value: JSON.parse(line),
              source: { lineStart: i + 1, lineEnd: i + 1 },
              annotations: {},
            }))
        : await Promise.all(
            ['auth.ts', 'colors.ts'].map(async (name, i) => ({
              id: String(i + 1),
              value: {
                path: `repository/${name}`,
                relativePath: name,
                content: await readFile(`fixtures/release/repository/${name}`, 'utf8'),
              },
              source: { path: `repository/${name}` },
              annotations: {},
            })),
          );
    const evidence = wire(records);
    const final = 'Test-only prose awaiting source review.';
    const a = {
      recipe,
      final,
      stages: [
        { args: [], input: source, out: evidence, code: 0 },
        { args: [], input: evidence, out: final, code: 0 },
      ],
    };

    expect(gradeWorkflow(a).find((c) => c.id === 'evidence-retention')?.verdict).toBe('pass');
    const lines = evidence.trim().split('\n');
    const row = JSON.parse(lines[1]);

    if (recipe === 'triage') row.value.body += ' invented';
    else row.value.content = row.value.content.replace('expiresAt > now', 'expiresAt < now');
    lines[1] = JSON.stringify(row);
    a.stages.at(-1)!.input = lines.join('\n') + '\n';
    failure(gradeWorkflow(a), 'evidence-retention');
  }
});

test('reviews are version/input/output bound; missing, fabricated and duplicate evidence cannot pass', () => {
  const control = controls[0];
  const c = fixture(control.id);
  const entry = reviews.entries.find((r) => r.id === control.id && r.outputSha256 === hash(control.out))!;
  const doc = (): Reviews => ({ schemaVersion: 1, rubricVersion: RUBRIC_VERSION, entries: [structuredClone(entry)] });
  const changed = gradeCommand(c, { code: 0, out: control.out + '\n' }, reviews);

  expect(status(changed)).toBe('review_required');
  const stale = doc();

  stale.entries[0].caseSha256 = hash('another fixture');
  expect(status(gradeCommand(c, { code: 0, out: control.out }, stale))).toBe('review_required');
  expect(() => reviewsSchema.parse({ ...reviewsFile, rubricVersion: '1.0.0' })).toThrow();
  const invalid = doc();

  invalid.entries[0].judgments[0].quote = 'fabricated quote';
  expect(() => gradeCommand(c, { code: 0, out: control.out }, invalid)).toThrow('unresolvable');
  const duplicate = doc();

  duplicate.entries.push(structuredClone(entry));
  expect(() => gradeCommand(c, { code: 0, out: control.out }, duplicate)).toThrow('Duplicate review');
  const missing = doc();

  missing.entries[0].judgments = [];
  missing.entries[0].reviewer = { kind: 'human', name: 'test-only fictional reviewer' };
  expect(status(gradeCommand(c, { code: 0, out: control.out }, missing))).toBe('review_required');
  expect(caseHash(c.id)).toBe(entry.caseSha256);
});

test('offline CLI needs no provider, refuses overwrites, and handles unknown/incomplete reports honestly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-regrade-'));

  try {
    const path = join(dir, 'report.json');
    const raw = JSON.stringify({
      schemaVersion: 1,
      attempts: [{ id: 'unknown', code: 0, repetition: 1, out: 'ungraded' }],
    });

    await writeFile(path, raw);
    const unknown = regrade(raw, reviews);

    expect(unknown.status).toBe('review_required');
    expect(unknown.sourceCompletion).toBe('unknown');
    const p = Bun.spawn(['bun', resolve('scripts/release/regrade.ts'), path, '--output', path], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { PATH: process.env.PATH },
    });

    await new Response(p.stderr).text();
    expect(await p.exited).not.toBe(0);
    expect(await readFile(path, 'utf8')).toBe(raw);
    const result = Bun.spawn(['bun', resolve('scripts/release/regrade.ts'), path], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { PATH: process.env.PATH },
    });
    const stdout = await new Response(result.stdout).text();

    expect(await result.exited, await new Response(result.stderr).text()).toBe(0);
    expect(JSON.parse(stdout).status).toBe('review_required');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
