import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { renderReport } from '../../scripts/release/report.ts';
import { regrade } from '../../scripts/release/regrade.ts';
import { reviewsSchema } from '../../scripts/release/rubric.ts';
import { cases } from '../../scripts/release/cases.ts';
import controls from '../../fixtures/evals/contradictions.json';
import controlReviews from '../../fixtures/evals/control-reviews.json';

const sha = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');
const criterion = (verdict = 'pass') => ({ id: 'fact-check', layer: 'fact', verdict, expected: 2, actual: 2 });
const attempt = (status = 'pass') => ({ id: 'synthetic', repetition: 1, status, criteria: [criterion(status)] });
const report = (status = 'pass') => ({
  schemaVersion: 2,
  rubricVersion: '2.0.0',
  pass: status === 'pass',
  status,
  attempts: [attempt(status)],
});
const render = (value: unknown) => renderReport(JSON.stringify(value), 'synthetic.json');

test('recorded states lead output, remain distinct, and never trigger grading', () => {
  for (const state of ['pass', 'fail', 'review_required', 'not_applicable']) {
    const text = render(report(state));

    expect(text.startsWith('Completion: complete')).toBe(true);
    expect(text).toContain(`Recorded acceptance: ${state}`);
    expect(text).toContain(`[fact]: ${state}`);
    expect(text).toContain('rubric: "2.0.0"');
    expect(text).toContain('Recorded revision: <not recorded>');
    expect(text).toContain('#/attempts/0/criteria/0');
  }
  const raw = JSON.stringify(report());

  expect(renderReport(raw)).toBe(renderReport(raw));
  expect(renderReport(raw)).toContain(sha(raw));
});

test('incomplete, empty and contradictory evidence is not an accepted evaluation', () => {
  for (const value of [
    { schemaVersion: 2, attempts: [] },
    { ...report(), attempts: [] },
    { schemaVersion: 2, rubricVersion: '2.0.0' },
    { ...report(), pass: undefined },
    { ...report(), attempts: [{ ...attempt(), criteria: [] }] },
    { ...report(), attempts: [{ ...attempt(), criteria: undefined }] },
    { ...report(), attempts: [{ ...attempt(), criteria: [criterion('not_applicable')] }] },
    { ...report(), attempts: [{ ...attempt(), criteria: [{ ...criterion(), actual: undefined }] }] },
    { ...report(), rubricVersion: undefined },
    { ...report(), attempts: [{ ...attempt(), criteria: [criterion('fail')] }] },
    { ...report(), attempts: [attempt('review_required')] },
    { ...report(), attempts: [attempt('not_applicable')] },
    { ...report(), pass: false },
    { ...report(), attempts: [{ id: 'synthetic' }] },
    { ...report(), summary: { pass: 100, total: 100 } },
    { ...report(), repetitions: 3 },
    { ...report(), repetitions: 2, attempts: [attempt(), attempt()] },
  ]) {
    const text = render(value);

    expect(text).toContain('Acceptance evidence: not established or inconsistent');
    expect(text).toContain('Warning:');
  }
  expect(render({ schemaVersion: 2, attempts: [] })).toContain('Recorded acceptance: unknown');
  expect(render({ ...report(), kind: 'offline-regrade', sourceCompletion: 'unknown' })).toContain(
    'Source completion: unknown',
  );
  expect(render({ ...report(), kind: 'offline-regrade', sourceCompletion: 'interrupted' })).toContain(
    'Source completion: interrupted',
  );
});

test('legacy command, corrected workflow, and root handoff preserve historical floors', () => {
  const legacy = {
    schemaVersion: 1,
    pass: true,
    attempts: [{ id: 'old', repetition: 1, pass: true, out: 'Mina Friday 240', firstPassCorrect: true }],
  };

  expect(render(legacy)).toContain('legacy regression/keyword-floor grade; not factual acceptance');
  expect(render(legacy)).toContain('firstPassCorrect: true');
  expect(render(legacy)).toContain('criteria/layers: not recorded; no grades inferred');
  const corrected = render({
    ...legacy,
    derivation: {
      source: 'report.original.json',
      sourceSha256: 'a'.repeat(64),
      operation: 'Recovered stats; verdicts unchanged',
    },
    attempts: [
      {
        recipe: 'triage',
        mode: 'mixed',
        repetition: 3,
        pass: true,
        final: 'Legacy words',
        falseNegativesFromSelection: 0,
      },
    ],
  });

  expect(corrected).toContain('"report.original.json"');
  expect(corrected).toContain('a'.repeat(64));
  expect(corrected).toContain('route "mixed" | repetition 3');
  expect(corrected).toContain('falseNegativesFromSelection: 0');
  expect(corrected).toContain('do not establish correctness or measured recall');
  expect(corrected).toContain('selectionRecall: unknown');
  const handoff = render({
    schemaVersion: 1,
    pass: true,
    harness: 'codex synthetic',
    answer: 'Legacy answer',
    code: 0,
  });

  expect(handoff).toContain('Format: legacy-handoff v1');
  expect(handoff).toContain('Recorded attempts/results: 1');
  expect(handoff).toContain('repetition <not recorded>');
  expect(handoff).toContain('"Legacy answer"');
});

test('repetitions, routes, source indices and provenance survive problem-first ordering', () => {
  const value = {
    ...report('fail'),
    kind: 'offline-regrade',
    sourceCompletion: 'complete',
    sourceReport: '../../not-to-be-opened.json',
    sourceReportSha256: 'b'.repeat(64),
    fixtureHashes: { 'fixture.json': 'c'.repeat(64) },
    graderSha256: 'd'.repeat(64),
    attempts: [
      { ...attempt(), repetition: 1 },
      { ...attempt('review_required'), id: 'triage', mode: 'local-only', repetition: 2 },
      {
        ...attempt('fail'),
        id: 'triage',
        mode: 'mixed',
        repetition: 3,
        sourceAttempt: 42,
        historical: { pass: true, failure: 'Recorded failure text '.repeat(100) },
        caseSha256: 'e'.repeat(64),
        outputSha256: 'f'.repeat(64),
        stages: [{ stats: { routes: [{ provider: 'local', model: 'small', source: { model: 'step' } }], tokens: 0 } }],
        criteria: [
          {
            ...criterion('fail'),
            reason: 'Contradiction',
            method: 'ai: synthetic',
            evidence: [{ start: 0, end: 5, quote: 'wrong' }],
          },
        ],
      },
    ],
  };
  const before = JSON.stringify(value);
  const text = render(value);

  expect(text.indexOf('FAIL "triage"')).toBeLessThan(text.indexOf('REVIEW_REQUIRED "triage"'));
  expect(text.indexOf('REVIEW_REQUIRED "triage"')).toBeLessThan(text.indexOf('PASS "synthetic"'));
  expect(text).toContain('#/attempts/2/criteria/0');
  expect(text).toContain('sourceAttempt: 42');
  expect(text).toContain('historical pass (recorded): true');
  expect(text).toContain('"model":"small"');
  expect(text).toContain('evidence [0,5)');
  for (const char of ['b', 'c', 'd', 'e', 'f']) expect(text).toContain(char.repeat(64));
  expect(JSON.stringify(value)).toBe(before);
});

test('current workflow and handoff reports keep route modes and stage identities', () => {
  for (const mode of ['local-only', 'direct-stronger', 'mixed', 'codex-handoff']) {
    const text = render({
      ...report('review_required'),
      attempts: [
        {
          recipe: 'context',
          mode,
          repetition: 2,
          status: 'review_required',
          criteria: [criterion('review_required')],
          stages: [
            { args: ['find', 'repository'], code: 0, stats: { requests: 0, tokens: 0, routes: [] } },
            {
              args: ['ask', 'synthetic'],
              code: 0,
              stats: { requests: 1, tokens: 'unknown', routes: [{ provider: 'local', model: 'strong' }] },
            },
          ],
        },
      ],
    });

    expect(text).toContain(`route "${mode}" | repetition 2`);
    expect(text).toContain('Stage 1: #/attempts/0/stages/1');
    expect(text).toContain('"model":"strong"');
    expect(text).toContain('tokens: unknown');
    expect(text).toContain('tokens: 0');
  }
});

test('unknown usage is not zero and first-call validity is not factual correctness', () => {
  const text = render({
    ...report(),
    attempts: [
      {
        ...attempt(),
        id: 'unknown',
        stats: { tokens: 'unknown', requests: null },
        firstCallValid: true,
        factualCorrect: null,
      },
      { ...attempt(), id: 'zero', stats: { tokens: 0, requests: 0, retries: 0, repairs: 0 } },
    ],
  });

  expect(text).toContain('tokens: unknown');
  expect(text).toContain('requests: unknown');
  expect(text).toContain('tokens: 0');
  expect(text).toContain('requests: 0');
  expect(text).toContain('repairs: unknown');
  expect(text).toContain('repairs: 0');
  expect(text).toContain('cost: unknown');
  expect(text).toContain('firstCallValid: true');
  expect(text).toContain('factualCorrect: null');
});

test('all contradiction controls preserve legacy passes and explicitly regraded failures', () => {
  const reviews = reviewsSchema.parse(controlReviews);

  for (const control of controls) {
    const fixture = cases().find((c) => c.id === control.id)!;
    const raw = JSON.stringify({
      schemaVersion: 1,
      pass: true,
      attempts: [
        {
          id: control.id,
          repetition: 1,
          pass: true,
          code: 0,
          out: control.out,
          input: fixture.input ?? null,
          args: fixture.args,
        },
      ],
    });
    const original = renderReport(raw);
    const derived = render(regrade(raw, reviews));

    expect(original).toContain('Recorded acceptance: pass (legacy');
    expect(derived).toContain('Recorded acceptance: fail');
    expect(derived).toContain('historical pass (recorded): true');
    for (const id of control.failed) expect(derived).toContain(`"${id}" [`);
  }
});

test('fixture diagnostics remain inert descriptors, including absent and truncated diagnostics', () => {
  const results = [
    { file: 'pass.json', pass: true },
    { file: 'old.json', pass: false },
    {
      file: 'value.json',
      pass: false,
      diagnostic: {
        kind: 'value-mismatch',
        path: '/a~1b',
        pathTruncated: true,
        expected: { type: 'missing', preview: '<missing>', truncated: false },
        actual: { type: 'string', preview: '"partial' + '\u001b'.repeat(240) + '\ud800', truncated: true },
      },
    },
    {
      file: 'error.json',
      pass: false,
      diagnostic: { kind: 'error-mismatch', expected: { outcome: 'error', code: 2 }, actual: { outcome: 'return' } },
    },
    ...['execution-failure', 'fixture-json', 'diagnostic-unavailable'].map((kind) => ({
      file: `${kind}.json`,
      pass: false,
      message: 'Safe diagnostic',
      diagnostic: { kind },
    })),
  ];
  const text = render({ schemaVersion: 1, passed: 1, failed: 6, results });

  expect(text).toContain('Recorded acceptance: fail');
  expect(text).toContain('recorded truncated=true');
  expect(text).toContain('expected type="missing"');
  expect(text).toContain('mismatch pointer: "/a~1b"');
  expect(text).toContain('[truncated: recorded mismatch path]');
  expect(text).toContain('expected/actual: not recorded');
  for (const result of results.slice(3)) expect(text).toContain(result.diagnostic!.kind);
  expect(render({ schemaVersion: 1, passed: 0, failed: 0, results: [] })).toContain('no acceptance established');
  expect(render({ schemaVersion: 1, passed: 1, failed: 0, results })).toContain('Recorded fixture totals disagree');
});

test('passing fixtures with failure diagnostics warn without changing recorded verdicts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-report-conflicts-'));
  const diagnostics = [
    {
      kind: 'value-mismatch',
      path: '',
      expected: { type: 'number', preview: '2', truncated: false },
      actual: { type: 'number', preview: '3', truncated: false },
    },
    { kind: 'error-mismatch', expected: { outcome: 'error', code: 2 }, actual: { outcome: 'return' } },
    ...['execution-failure', 'fixture-json', 'diagnostic-unavailable'].map((kind) => ({ kind })),
  ];

  try {
    const path = join(dir, 'report.json');

    for (const diagnostic of diagnostics) {
      const raw = JSON.stringify({
        schemaVersion: 1,
        passed: 1,
        failed: 0,
        results: [{ file: 'synthetic.json', pass: true, diagnostic }],
      });

      await writeFile(path, raw);
      const result = await cli(dir, [path]);

      expect(result.code).toBe(0);
      expect(result.err).toBe('');
      expect(result.out).toContain('Recorded acceptance: pass');
      expect(result.out).toContain('pass=1 fail=0');
      expect(result.out).toContain('PASS "synthetic.json"');
      expect(result.out).toContain('Acceptance evidence: not established or inconsistent');
      expect(result.out).toContain('Warning: A recorded passing result contains a failure diagnostic.');
      expect(result.out).toContain(`diagnostic: "${diagnostic.kind}"`);
      expect(await readFile(path, 'utf8')).toBe(raw);
    }
    const expectedError = render({
      schemaVersion: 1,
      passed: 1,
      failed: 0,
      results: [{ file: 'expected-error.json', pass: true, error: 2, message: 'Expected rejection' }],
    });

    expect(expectedError).toContain('Recorded acceptance: pass');
    expect(expectedError).toContain('Acceptance evidence: fixture contract only');
    expect(expectedError).toContain('error: 2');
    expect(expectedError).not.toContain('Warning:');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === 'win32')(
  'nonregular report inputs cannot block open; regular-file symlinks work',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ribbit-report-fifo-'));

    try {
      const raw = JSON.stringify(report());

      await writeFile(join(dir, 'report.json'), raw);
      // Python supervises each CLI process so a blocked open cannot outlive the regression test.
      const child = Bun.spawn(
        [
          'python3',
          '-c',
          `
import json, os, subprocess, sys
os.mkfifo('fifo')
os.symlink('fifo', 'fifo-link')
os.symlink('report.json', 'report-link')
results = []
for path in ['fifo', 'fifo-link', '.', '/dev/null', 'report-link']:
    result = subprocess.run([sys.argv[1], sys.argv[2], path], capture_output=True, text=True, timeout=3)
    results.append(dict(path=path, code=result.returncode, out=result.stdout, err=result.stderr))
print(json.dumps(results))
`,
          process.execPath,
          script,
        ],
        { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH, HOME: dir } },
      );
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(code, err).toBe(0);
      const results = JSON.parse(out) as { path: string; code: number; out: string; err: string }[];

      expect(results).toHaveLength(5);
      for (const result of results.slice(0, 4)) {
        expect(result.code, result.path).toBe(2);
        expect(result.out).toBe('');
        expect(result.err).toBe('eval:report: Input must be a regular report file\n');
      }
      expect(results[4]).toEqual({ path: 'report-link', code: 0, out: renderReport(raw, 'report-link'), err: '' });
      expect(await readFile(join(dir, 'report.json'), 'utf8')).toBe(raw);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  10000,
);

test('bounded previews escape every display boundary without splitting Unicode', () => {
  const hostile = '\u001b]8;;https://example.test\u0007\r\n\u009b\u202e\u2066\ud800';
  const value = {
    ...report('fail'),
    revision: hostile,
    attempts: [
      {
        ...attempt('fail'),
        id: hostile,
        mode: hostile,
        criteria: [
          {
            ...criterion('fail'),
            id: hostile,
            expected: '日本語😀'.repeat(1000),
            actual: { [hostile]: hostile },
            reason: hostile,
            evidence: [{ start: 0, end: 1, quote: hostile }],
          },
        ],
      },
    ],
  };
  const text = renderReport(JSON.stringify(value), hostile);

  for (const char of ['\u001b', '\u0007', '\r', '\u009b', '\u202e', '\u2066', '\ud800'])
    expect(text).not.toContain(char);
  expect(text).toContain('\\u001b');
  expect(text).toContain('日本語😀');
  expect(text).toContain('[truncated]');
  expect(Buffer.from(text).toString('utf8')).toBe(text);
  expect(text).toBe(renderReport(JSON.stringify(value), hostile));
  let nested: unknown = null;

  for (let i = 0; i < 100; i++) nested = { nested };
  expect(render({ ...report(), build: nested })).toContain('[truncated: nesting]');
});

test('detail and total output bounds retain problem references and mark omissions', () => {
  const many = {
    ...report('fail'),
    attempts: Array.from({ length: 25 }, (_, i) => ({
      ...attempt('fail'),
      id: `case-${i}`,
      criteria: Array.from({ length: 12 }, (_criterion, j) => ({
        ...criterion('fail'),
        id: `criterion-${j}`,
        evidence: Array.from({ length: 3 }, () => ({ start: 0, end: 1, quote: 'x' })),
      })),
    })),
  };
  const text = render(many);

  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
  expect(text).toContain('[truncated: 1 evidence spans omitted]');
  expect(text).toContain('[truncated: 2 criteria omitted');
  expect(text).toContain('[truncated:');
  expect(render({ ...report(), attempts: Array.from({ length: 21 }, () => attempt()) })).toContain(
    '1 attempts/results omitted',
  );
  const huge = render({
    ...report('fail'),
    attempts: Array.from({ length: 20 }, () => ({
      ...attempt('fail'),
      criteria: Array.from({ length: 10 }, () => ({
        ...criterion('fail'),
        expected: '😀'.repeat(10000),
        actual: '界'.repeat(10000),
      })),
    })),
  });

  expect(Buffer.byteLength(huge)).toBeLessThanOrEqual(65536);
  expect(huge).toContain('[truncated: output limit');
  expect(Buffer.from(huge).toString('utf8')).toBe(huge);
});

test('malformed and unsupported reports fail without exposing input', () => {
  for (const raw of [
    'PRIVATE broken JSON',
    '{}',
    'null',
    '{"schemaVersion":3}',
    '{"schemaVersion":1,"kind":"baseline-environment"}',
    '{"schemaVersion":1,"rubricVersion":"2.0.1","entries":[]}',
    '{"schemaVersion":1,"harness":"synthetic","answer":"ok","stats":false}',
    JSON.stringify({ ...report(), attempts: 'wrong' }),
    JSON.stringify({ ...report(), attempts: [{ ...attempt(), status: 'accepted' }] }),
    JSON.stringify({ ...report(), attempts: [{}] }),
    '{"schemaVersion":2,"attempts":[],"opaque":1e999}',
  ])
    expect(() => renderReport(raw)).toThrow();
  expect(() => renderReport(' '.repeat(32 * 1024 * 1024 + 1))).toThrow('32 MiB');
});

const script = resolve('scripts/release/report.ts');

async function cli(dir: string, args: string[]) {
  const child = Bun.spawn(['bun', script, ...args], {
    cwd: dir,
    env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { out, err, code };
}

test('CLI stays offline, preserves hashes, distinguishes render success, and refuses overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-report-'));
  let requests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      requests++;

      return new Response('Unexpected');
    },
  });

  try {
    const url = `http://127.0.0.1:${server.port}/report.json`;
    const marker = join(dir, 'EXECUTED');
    const extension = join(dir, 'extension.ts');

    await writeFile(
      extension,
      `await Bun.write(${JSON.stringify(marker)}, 'executed'); throw new Error('Do not import');`,
    );
    for (const value of [report('fail'), report('review_required'), { schemaVersion: 2, attempts: [] }]) {
      const raw = JSON.stringify({
        ...value,
        sourceReport: url,
        endpoint: url,
        artifact: extension,
        args: ['bun', extension],
      });
      const path = join(dir, 'report.json');

      await writeFile(path, raw);
      const result = await cli(dir, [path]);

      expect(result.code).toBe(0);
      expect(result.err).toBe('');
      expect(result.out).toBe(renderReport(raw, path));
      expect(sha(await readFile(path))).toBe(sha(raw));
      const overwrite = await cli(dir, [path, '--output', path]);

      expect(overwrite.code).toBe(1);
      expect(overwrite.out).toBe('');
      expect(overwrite.err).toContain('must not already exist');
      expect(sha(await readFile(path))).toBe(sha(raw));
    }
    const output = join(dir, 'new.txt');
    const made = await cli(dir, ['report.json', '--output', output]);

    expect(made).toEqual({ code: 0, out: '', err: '' });
    expect(await readFile(output, 'utf8')).toContain('Recorded acceptance: unknown');
    const before = sha(await readFile(output));

    expect((await cli(dir, ['report.json', '--output', output])).code).toBe(1);
    expect(sha(await readFile(output))).toBe(before);
    expect((await cli(dir, ['--help'])).code).toBe(0);
    expect((await cli(dir, ['missing.json'])).code).toBe(1);
    for (const args of [
      [],
      ['--wat'],
      ['report.json', '--wat', 'x'],
      ['report.json', '--output'],
      ['report.json', '--help'],
      ['report.json', '--output', 'x', '--output', 'y'],
    ]) {
      const result = await cli(dir, args);

      expect(result.code).toBe(2);
      expect(result.out).toBe('');
      expect(result.err).toContain('eval:report:');
    }
    for (const contents of [
      Buffer.from('PRIVATE broken'),
      Buffer.from([0xff]),
      Buffer.from('{"schemaVersion":99}'),
      Buffer.alloc(32 * 1024 * 1024 + 1, 32),
    ]) {
      await writeFile(join(dir, 'bad.json'), contents);
      const result = await cli(dir, ['bad.json']);

      expect(result.code).toBe(2);
      expect(result.out).toBe('');
      expect(result.err).not.toContain('PRIVATE');
    }
    expect(requests).toBe(0);
    expect(await stat(marker).catch(() => null)).toBeNull();
  } finally {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});
