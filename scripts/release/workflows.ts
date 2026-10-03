import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sandbox, parseStats, evaluationProvenance } from './harness.ts';
import { rows } from './cases.ts';
import { RUBRIC_VERSION, fixtureHashes, gradeWorkflow, status } from './rubric.ts';

if (process.env.RIBBIT_RUN_LIVE_EVAL !== '1') throw new Error('Set RIBBIT_RUN_LIVE_EVAL=1');
const small = process.argv[2],
  strong = process.argv[3];

if (!small || !strong) throw new Error('Supply SMALL_MODEL STRONG_MODEL (already loaded on loopback LM Studio)');
const env = await sandbox({
  providers: {
    local: {
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      capabilities: ['text', 'object', 'stream', 'maxOutputTokens', 'temperature'],
    },
  },
  profiles: {
    'local-small': { provider: 'local', model: small, maxOutputTokens: 2048, temperature: 0 },
    stronger: { provider: 'local', model: strong, maxOutputTokens: 2048, temperature: 0 },
  },
});
const directory = `evals/results/workflows/${new Date().toISOString().replace(/[:.]/g, '-')}`;

await mkdir(directory, { recursive: true });
const attempts: any[] = [];
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const report: any = {
  schemaVersion: 2,
  rubricVersion: RUBRIC_VERSION,
  fixtureHashes,
  date: new Date().toISOString(),
  ...(await evaluationProvenance()),
  small,
  strong,
  binarySha256: sha(await readFile(env.binary)),
  scriptSha256: sha(await readFile('scripts/release/workflows.ts')),
  repetitions: 3,
  attempts,
  limitations: [
    'Synthetic public fixtures; exact retention checks and explicit source-grounded prose review',
    'No independent reviewer or held-out generalization claim',
    'Wall time includes CLI overhead; provider cache state not controlled',
    'Full evidence is retained; no context-saving claim',
  ],
  acceptance:
    'Each recipe/route must satisfy the same layered criteria on all three repetitions; review_required is not a pass.',
};
const instruction =
  'Prioritize the tickets. Cite every ticket ID and preserve accessibility failures. Treat labels as fallible suggestions; verify against original bodies. Separate observations from hypotheses.';
const source = await readFile('fixtures/release/feedback.jsonl', 'utf8');
const meeting = await readFile('fixtures/release/meeting.txt', 'utf8');

try {
  for (let repetition = 1; repetition <= 3; repetition++)
    for (const recipe of ['triage', 'context', 'brief'])
      for (const mode of ['local-only', 'direct-stronger', 'mixed']) {
        const stages: any[] = [];
        const run = async (args: string[], input = '') => {
          const result = await env.run([...args, '--stats', '--request-ms', '30000', '--total-ms', '90000'], input);
          const stats = parseStats(result.err);

          stages.push({ args, input, ...result, stats });
          if (result.code) throw new Error(`CLI exit ${result.code}`);

          return result.out;
        };
        const finalProfile = mode === 'local-only' ? 'local-small' : 'stronger';
        let failure = null,
          final = '',
          downstreamBytes = 0,
          evidenceRetention: number | null = null;
        const started = performance.now();

        try {
          if (recipe === 'triage') {
            let evidence = await run(['select', 'ticket,body,component', '--input', 'jsonl'], source);

            if (mode !== 'direct-stronger')
              evidence = await run(
                [
                  'classify',
                  '--field',
                  'body',
                  '--label',
                  'blocking=Prevents a customer from completing a purchase',
                  '--label',
                  'cosmetic=Appearance or wording with no functional impact',
                  '--label',
                  'unknown=Insufficient evidence',
                  '--unknown-label',
                  'unknown',
                  '--profile',
                  'local-small',
                ],
                evidence,
              );
            const admitted = rows(evidence);

            downstreamBytes = Buffer.byteLength(admitted.map((r) => JSON.stringify(r)).join('\n'));
            final = await run(['reduce', instruction, '--profile', finalProfile], evidence);
          } else if (recipe === 'context') {
            let evidence = await run([
              'find',
              'repository',
              '--kind',
              'file',
              '--read',
              'content',
              '--max-files',
              '40',
            ]);

            if (mode !== 'direct-stronger')
              evidence = await run(
                [
                  'classify',
                  '--field',
                  'content',
                  '--label',
                  'relevant=Session expiration or request authentication',
                  '--label',
                  'other=Unrelated to authentication',
                  '--profile',
                  'local-small',
                ],
                evidence,
              );
            const admitted = rows(evidence);

            downstreamBytes = Buffer.byteLength(admitted.map((r) => JSON.stringify(r)).join('\n'));
            final = await run(
              [
                'ask',
                'Explain which source implements session expiration. Cite auth.ts and distinguish colors.ts. State the expiresAt > now condition. Treat labels as fallible.',
                '--profile',
                finalProfile,
              ],
              evidence,
            );
          } else {
            let evidence = meeting;

            if (mode !== 'direct-stronger')
              evidence = await run(
                [
                  'summarize',
                  '--words',
                  '40',
                  '--rule',
                  'Preserve names, dates, amounts, and unresolved questions.',
                  '--profile',
                  'local-small',
                ],
                evidence,
              );
            downstreamBytes = Buffer.byteLength(evidence);
            final = await run(
              [
                'rewrite',
                'Use plain language; preserve every name, date, amount, and unresolved question.',
                '--profile',
                finalProfile,
              ],
              evidence,
            );
          }
        } catch (error) {
          failure = (error as Error).message;
        }
        const criteria = gradeWorkflow({ recipe, final, stages });
        const verdict = status(criteria);

        evidenceRetention =
          criteria.find((criterion) => criterion.id === 'evidence-retention')?.verdict === 'pass' ? 1 : null;
        failure ??=
          criteria.find((criterion) => criterion.verdict === 'fail')?.reason ??
          (verdict === 'review_required' ? 'Source-grounded review required' : null);
        attempts.push({
          recipe,
          mode,
          repetition,
          stages,
          final,
          failure,
          rubricVersion: RUBRIC_VERSION,
          criteria,
          status: verdict,
          pass: verdict === 'pass',
          elapsedMs: performance.now() - started,
          downstreamBytes,
          evidenceRetention,
          falseNegativesFromSelection: null,
          requests: stages.some((s) => !s.stats) ? null : stages.reduce((n, s) => n + s.stats.requests, 0),
          tokens: stages.some((s) => !s.stats || s.stats.tokens === 'unknown')
            ? null
            : stages.reduce((n, s) => n + s.stats.tokens, 0),
        });
        await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
        console.log(`${attempts.length}/27 ${recipe} ${mode}: ${failure ?? 'pass'}`);
      }
  report.status = status(attempts.flatMap((a) => a.criteria));
  report.pass = report.status === 'pass';
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(directory);
  if (!report.pass) process.exitCode = 1;
} finally {
  await env.close();
}
