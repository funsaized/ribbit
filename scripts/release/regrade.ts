import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { hash } from '../../src/sdk/manifest/index.ts';
import { cases, pickerCase } from './cases.ts';
import {
  RUBRIC_VERSION,
  fixtureHashes,
  caseHash,
  gradeCommand,
  gradeWorkflow,
  reviewsSchema,
  status,
  type Reviews,
} from './rubric.ts';

const stage = z.object({ args: z.array(z.string()), input: z.string(), out: z.string(), code: z.number().int() });
const legacy = { pass: z.boolean().optional(), failure: z.string().nullable().optional() };
const reportSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  pass: z.boolean().optional(),
  attempts: z
    .array(
      z.union([
        z.object({
          ...legacy,
          id: z.string(),
          code: z.number().int(),
          out: z.string(),
          repetition: z.number().int(),
          input: z.string().nullable().optional(),
          args: z.array(z.string()).optional(),
        }),
        z.object({
          ...legacy,
          recipe: z.string(),
          mode: z.string(),
          final: z.string(),
          stages: z.array(stage),
          repetition: z.number().int(),
        }),
      ]),
    )
    .min(1),
});

export function regrade(raw: string, reviews?: Reviews) {
  const report = reportSchema.parse(JSON.parse(raw));
  const catalog = [...cases(), pickerCase];
  const attempts = report.attempts.map((attempt, index) => {
    const id = 'recipe' in attempt ? attempt.recipe : attempt.id;
    const fixture = catalog.find((c) => c.id === id);
    const criteria =
      'recipe' in attempt
        ? gradeWorkflow(attempt, reviews)
        : fixture
          ? gradeCommand(fixture, attempt, reviews)
          : [
              {
                id: 'known-case',
                layer: 'review' as const,
                verdict: 'review_required' as const,
                expected: 'Known versioned fixture',
                actual: id,
              },
            ];

    if (fixture && 'id' in attempt) {
      const matches =
        (attempt.input === undefined || attempt.input === (fixture.input ?? null)) &&
        (attempt.args === undefined || JSON.stringify(attempt.args) === JSON.stringify(fixture.args));

      const complete = attempt.input !== undefined && attempt.args !== undefined;

      criteria.push({
        id: 'fixture-match',
        layer: 'invariant',
        expected: { input: fixture.input ?? null, args: fixture.args },
        actual: {
          input: attempt.input ?? null,
          args: attempt.args ?? null,
          inputProvided: attempt.input !== undefined,
          argsProvided: attempt.args !== undefined,
        },
        verdict: !matches ? 'fail' : complete ? 'pass' : 'review_required',
        reason: !matches
          ? 'Saved input/arguments differ from this rubric; do not apply its factual verdicts to another task.'
          : complete
            ? 'Saved input and arguments match the candidate fixture.'
            : 'Missing saved input or arguments; the candidate fixture hash does not prove which task was run.',
      });
    }

    return {
      sourceAttempt: index,
      id,
      caseVersion: RUBRIC_VERSION,
      caseSha256: caseHash(id),
      repetition: attempt.repetition,
      ...('recipe' in attempt ? { mode: attempt.mode, selectionRecall: null } : {}),
      outputSha256: hash('recipe' in attempt ? attempt.final : attempt.out),
      historical: { pass: attempt.pass ?? null, failure: attempt.failure ?? null },
      criteria,
      status: status(criteria),
    };
  });
  const counts = Object.fromEntries(
    ['pass', 'fail', 'review_required'].map((verdict) => [
      verdict,
      attempts.filter((a) => a.status === verdict).length,
    ]),
  );

  return {
    schemaVersion: 2,
    kind: 'offline-regrade',
    rubricVersion: RUBRIC_VERSION,
    sourceReportSha256: hash(raw),
    sourceCompletion: report.pass === undefined ? 'unknown' : 'complete',
    fixtureHashes,
    summary: counts,
    status: status(attempts.flatMap((a) => a.criteria)),
    attempts,
    limitations: [
      'New derived verdicts; original artifacts, verdicts and timings are not rewritten.',
      'Unreviewed prose is review_required, never a factual pass from keyword presence.',
      'AI source transcriptions are labeled; independent human review remains pending.',
      'No token, latency, cost or general recall estimates are inferred from saved bytes.',
    ],
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);

  if (argv.includes('--help')) {
    console.log(
      'bun run eval:regrade -- REPORT.json [--reviews REVIEWS.json] [--output NEW.json]\nOffline only. No reviews unless explicitly supplied; defaults to stdout. Output files must not already exist.',
    );
  } else {
    const [path, ...flags] = argv;
    const options: Record<string, string> = {};

    if (!path || flags.length % 2) throw new Error('Supply REPORT.json [--reviews REVIEWS.json] [--output NEW.json]');
    for (let i = 0; i < flags.length; i += 2) {
      const flag = flags[i];

      if (!['--reviews', '--output'].includes(flag) || options[flag])
        throw new Error(`Unknown or duplicate option: ${flag}`);
      options[flag] = flags[i + 1];
    }
    const raw = await readFile(path, 'utf8');
    const reviewRaw = options['--reviews'] ? await readFile(options['--reviews'], 'utf8') : null;
    const reviews = reviewRaw === null ? undefined : reviewsSchema.parse(JSON.parse(reviewRaw));
    const result = {
      ...regrade(raw, reviews),
      sourceReport: path,
      reviewsSha256: reviewRaw === null ? null : hash(reviewRaw),
      graderSha256: hash(await readFile(new URL('./rubric.ts', import.meta.url))),
      replaySha256: hash(await readFile(new URL('./regrade.ts', import.meta.url))),
    };
    const output = JSON.stringify(result, null, 2) + '\n';

    if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
    else process.stdout.write(output);
  }
}
