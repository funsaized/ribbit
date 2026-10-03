import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { cases, pickerCase } from './cases.ts';
import { RUBRIC_VERSION, fixtureHashes, gradeCommand, status } from './rubric.ts';
import { resolve } from 'node:path';
import { sandbox, parseStats, evaluationProvenance } from './harness.ts';

const argv = process.argv.slice(2);

function option(name: string, fallback?: string) {
  const i = argv.indexOf(name);

  return i < 0 ? fallback : argv[i + 1];
}

if (argv.includes('--help')) {
  console.log(
    'RIBBIT_RUN_LIVE_EVAL=1 bun run scripts/release/evaluate.ts --model MODEL [--url http://127.0.0.1:1234/v1] [--profile NAME] [--command NAME] [--mode smoke|full] [--quantization Q4_K_M]',
  );
  process.exit(0);
}
if (process.env.RIBBIT_RUN_LIVE_EVAL !== '1')
  throw new Error('Set RIBBIT_RUN_LIVE_EVAL=1 to run bounded local inference.');
const target = new URL(option('--url', 'http://127.0.0.1:1234/v1')!);

if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
  target.username ||
  target.password ||
  target.search ||
  target.hash
)
  throw new Error('Evaluation requires a loopback URL without credentials.');
const outputTokens = Number(option('--max-output-tokens', '2048'));

if (!Number.isInteger(outputTokens) || outputTokens < 1 || outputTokens > 4096)
  throw new Error('Output tokens must be 1..4096');
const model = option('--model');

if (!model) throw new Error('--model is required');
const mode = option('--mode', 'smoke');

if (!['smoke', 'full'].includes(mode!)) throw new Error('Use --mode smoke or full');
const profile = option('--profile', 'evaluation')!;
const selected = [...cases(), pickerCase].filter(
  (c) => c.semantic && (!option('--command') || c.command === option('--command')),
);

if (!selected.length) throw new Error('No semantic cases selected');
const repetitions = mode === 'full' ? 3 : 1;
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const directory = `evals/results/release/${new Date().toISOString().replace(/[:.]/g, '-')}-${model.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

await mkdir(directory, { recursive: true });
const attempts: any[] = [];
let transport: any[] = [];
// Record every request and raw provider response, including failed and repaired attempts.
const proxy = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  idleTimeout: 120,
  async fetch(req) {
    if (req.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await req.text();
    const started = performance.now();
    const attempt: any = { request: JSON.parse(body), pending: true };

    transport.push(attempt);

    try {
      const response = await fetch(target.toString().replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: req.signal,
      });
      const raw = await response.text();

      Object.assign(attempt, {
        pending: false,
        status: response.status,
        response: raw,
        elapsedMs: performance.now() - started,
      });

      return new Response(raw, {
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') ?? 'text/event-stream' },
      });
    } catch (error) {
      Object.assign(attempt, { pending: false, error: String(error), elapsedMs: performance.now() - started });

      return new Response('Recorded transport failure', { status: 502 });
    }
  },
});
const env = await sandbox({
  providers: {
    local: {
      type: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${proxy.port}/v1`,
      capabilities: ['text', 'object', 'stream', 'maxOutputTokens', 'temperature', 'reasoning'],
    },
  },
  profiles: {
    [profile]: { provider: 'local', model, maxOutputTokens: outputTokens, temperature: 0, reasoning: 'off' },
  },
  default: { profile },
});
const report: any = {
  schemaVersion: 2,
  rubricVersion: RUBRIC_VERSION,
  fixtureHashes,
  date: new Date().toISOString(),
  ...(await evaluationProvenance()),
  binarySha256: sha(await readFile(env.binary)),
  fixtureSha256: sha(await readFile('scripts/release/cases.ts')),
  model,
  profile,
  endpoint: target.toString(),
  quantization: option('--quantization') ?? null,
  modelDigest: process.env.RIBBIT_EVAL_MODEL_DIGEST ?? null,
  runtime: Bun.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0].model,
  memoryBytes: totalmem(),
  mode,
  repetitions,
  maxOutputTokens: outputTokens,
  requestMs: 30000,
  totalMs: 90000,
  dataset: 'Authored public regression fixtures, no held-out claim; no prompt tuning during this run.',
  limitations: [
    'Small regression sample, not broad quality certification',
    'Prose needs output-bound source review unless it exactly matches an authored reference',
    'Shape, invariants, facts, citations and independent review have separate criteria',
    'Recording proxy buffers SSE; wall time includes proxy and CLI overhead',
  ],
  thresholds:
    'Every required criterion must pass every repetition; review_required is not a pass. No aggregate waiver.',
  attempts,
};

try {
  for (let repetition = 1; repetition <= repetitions; repetition++)
    for (const c of selected) {
      transport = [];
      const args = [
        c.command,
        ...c.args,
        '--profile',
        profile,
        '--stats',
        '--request-ms',
        '30000',
        '--total-ms',
        '90000',
        '--max-requests',
        '8',
      ];
      let result;

      if (c.command === 'pick') {
        const started = performance.now();
        const p = Bun.spawn(
          [
            'python3',
            resolve('scripts/release/picker.py'),
            JSON.stringify([env.binary, ...args]),
            'select',
            'Checkout fails',
          ],
          { cwd: env.dir, env: env.env, stdout: 'pipe', stderr: 'pipe' },
        );
        const raw = await new Response(p.stdout).text();
        const error = await new Response(p.stderr).text();
        const code = await p.exited;
        const value = code === 0 ? JSON.parse(raw) : { code, out: '', screen: error };

        result = {
          code: Number(value.code),
          out: String(value.out),
          err: String(value.screen),
          elapsedMs: performance.now() - started,
        };
      } else result = await env.run(args, c.input);
      const criteria = gradeCommand(c, result);
      const verdict = status(criteria);
      const failure =
        criteria.find((criterion) => criterion.verdict === 'fail')?.reason ??
        (verdict === 'review_required' ? 'Source-grounded review required' : null);
      const stats = parseStats(result.err);

      attempts.push({
        id: c.id,
        command: c.command,
        repetition,
        args: c.args,
        input: c.input ?? null,
        ...result,
        stats,
        transport,
        rubricVersion: RUBRIC_VERSION,
        criteria,
        status: verdict,
        pass: verdict === 'pass',
        failure,
        firstCallValid: stats ? result.code === 0 && stats.repairs === 0 && stats.retries === 0 : null,
        factualCorrect: criteria.some((criterion) => criterion.layer === 'fact' && criterion.verdict === 'fail')
          ? false
          : verdict === 'pass'
            ? true
            : null,
      });
      await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
      console.log(`${attempts.length}/${selected.length * repetitions} ${c.id}: ${failure ?? 'pass'}`);
    }
  report.status = status(attempts.flatMap((a) => a.criteria));
  report.pass = report.status === 'pass';
  report.byCommand = Object.fromEntries(
    [...new Set(attempts.map((a) => a.command))].map((command) => [
      command,
      {
        passed: attempts.filter((a) => a.command === command && a.pass).length,
        total: attempts.filter((a) => a.command === command).length,
      },
    ]),
  );
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(directory);
  if (!report.pass) process.exitCode = 1;
} finally {
  await env.close();
  proxy.stop(true);
}
