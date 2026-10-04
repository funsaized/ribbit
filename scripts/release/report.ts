import { open, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const INPUT_BYTES = 32 * 1024 * 1024;
const OUTPUT_BYTES = 64 * 1024;
const verdict = z.enum(['pass', 'fail', 'review_required', 'not_applicable']);
const count = z.number().int().nonnegative();
const measurement = z
  .union([z.number().nonnegative(), z.literal('unknown')])
  .nullable()
  .optional();
const stats = z
  .object({
    requests: measurement,
    tokens: measurement,
    retries: measurement,
    repairs: measurement,
    cost: measurement,
    selectionRecall: measurement,
    routes: z.array(z.object({ provider: z.string(), model: z.string() }).passthrough()).optional(),
  })
  .passthrough();
const criterion = z.object({
  id: z.string(),
  layer: z.enum(['shape', 'invariant', 'fact', 'citation', 'review']),
  verdict,
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  reason: z.string().optional(),
  method: z.string().optional(),
  evidence: z.array(z.object({ start: count, end: count, quote: z.string() })).optional(),
});
const descriptor = z.object({ type: z.string(), preview: z.string(), truncated: z.boolean() });
const outcome = z.object({ outcome: z.enum(['return', 'error']), code: z.number().optional() });
const diagnostic = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('value-mismatch'),
    path: z.string(),
    pathTruncated: z.boolean().optional(),
    expected: descriptor,
    actual: descriptor,
  }),
  z.object({ kind: z.literal('error-mismatch'), expected: outcome, actual: outcome }),
  z.object({ kind: z.enum(['execution-failure', 'fixture-json', 'diagnostic-unavailable']) }),
]);
const entry = z
  .object({
    id: z.string().optional(),
    recipe: z.string().optional(),
    file: z.string().optional(),
    repetition: count.optional(),
    sourceAttempt: count.optional(),
    mode: z.string().optional(),
    status: verdict.optional(),
    pass: z.boolean().optional(),
    failure: z.string().nullable().optional(),
    criteria: z.array(criterion).optional(),
    historical: z
      .object({ pass: z.boolean().nullable().optional(), failure: z.string().nullable().optional() })
      .optional(),
    stats: stats.nullable().optional(),
    stages: z.array(z.object({ stats: stats.nullable().optional() }).passthrough()).optional(),
    diagnostic: diagnostic.optional(),
    requests: measurement,
    tokens: measurement,
    retries: measurement,
    repairs: measurement,
    cost: measurement,
    selectionRecall: measurement,
  })
  .passthrough();
const reportSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    kind: z.literal('offline-regrade').optional(),
    rubricVersion: z.string().optional(),
    status: verdict.optional(),
    pass: z.boolean().optional(),
    sourceCompletion: z.enum(['complete', 'unknown', 'interrupted']).optional(),
    attempts: z.array(entry).optional(),
    results: z.array(entry).optional(),
    passed: count.optional(),
    failed: count.optional(),
    repetitions: count.optional(),
    summary: z.record(z.string(), count).optional(),
  })
  .passthrough();

type Entry = z.infer<typeof entry>;
type State = z.infer<typeof verdict> | 'unknown';

class ReportError extends Error {}

// All report strings are data, including filenames, reasons and artifact references.
function escape(char: string): string {
  const cp = char.codePointAt(0)!;

  return cp < 32 ||
    (cp >= 127 && cp <= 159) ||
    cp === 0x61c ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    (cp >= 0xd800 && cp <= 0xdfff)
    ? `\\u${cp.toString(16).padStart(4, '0')}`
    : char;
}

function* notation(value: unknown, depth = 0): Generator<string> {
  if (value === undefined) {
    yield '<not recorded>';

    return;
  }
  if (typeof value === 'string') {
    yield '"';
    for (const char of value) yield char === '"' || char === '\\' ? `\\${char}` : escape(char);
    yield '"';
  } else if (value === null || typeof value !== 'object') yield Object.is(value, -0) ? '-0' : String(value);
  else if (depth === 8) yield '[truncated: nesting]';
  else {
    const array = Array.isArray(value);
    const keys = array ? null : Object.keys(value).toSorted();
    const length = array ? value.length : keys!.length;

    yield array ? '[' : '{';
    for (let i = 0; i < Math.min(length, 32); i++) {
      if (i) yield ',';
      if (!array) {
        yield* notation(keys![i]);
        yield ':';
      }
      yield* notation(array ? value[i] : (value as Record<string, unknown>)[keys![i]], depth + 1);
    }
    if (length > 32) yield ` [truncated: ${length - 32} members omitted]`;
    yield array ? ']' : '}';
  }
}

function preview(value: unknown): string {
  let result = '',
    characters = 0;

  for (const part of notation(value))
    for (const char of part) {
      if (characters++ === 512) return result + ' [truncated]';
      result += char;
    }

  return result;
}

function state(row: Entry, legacy: boolean): State {
  return row.status ?? (legacy && row.pass !== undefined ? (row.pass ? 'pass' : 'fail') : 'unknown');
}

function priority(row: Entry, legacy: boolean): number {
  const order = ['fail', 'review_required', 'unknown', 'pass', 'not_applicable'];
  let rank = order.indexOf(state(row, legacy));

  for (const c of row.criteria ?? []) rank = Math.min(rank, order.indexOf(c.verdict));

  return rank;
}

/** Display recorded evidence only: no grading, configuration, artifact reads or clock access. */
export function renderReport(raw: string, source = 'REPORT.json'): string {
  if (Buffer.byteLength(raw) > INPUT_BYTES) throw new ReportError('Report exceeds the 32 MiB input limit');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ReportError('Malformed report JSON');
  }
  const checked = reportSchema.safeParse(parsed);

  if (!checked.success)
    throw new ReportError('Malformed report or unsupported format/version (expected a supported v1/v2 report)');
  const report = checked.data;
  const fixtures = report.results !== undefined;
  const regrade = report.kind === 'offline-regrade';
  const legacyHandoff =
    !fixtures &&
    report.schemaVersion === 1 &&
    report.attempts === undefined &&
    typeof report.harness === 'string' &&
    typeof report.answer === 'string';

  if (
    (fixtures && (report.schemaVersion !== 1 || report.attempts !== undefined || regrade)) ||
    (regrade && report.schemaVersion !== 2) ||
    (!fixtures &&
      !legacyHandoff &&
      !regrade &&
      report.attempts === undefined &&
      !(report.schemaVersion === 2 && report.rubricVersion !== undefined))
  )
    throw new ReportError('Unsupported report format/version combination');
  // JSON.parse accepts overflowing numbers; reject them even inside opaque recorded values.
  const pending: unknown[] = [parsed];

  while (pending.length) {
    const value = pending.pop();

    if (typeof value === 'number' && !Number.isFinite(value))
      throw new ReportError('Report contains a non-finite number');
    if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push(child);
  }
  const legacy = fixtures || report.schemaVersion === 1;
  const handoff = legacyHandoff ? entry.safeParse(report) : undefined;

  if (handoff && !handoff.success) throw new ReportError('Malformed legacy handoff result');
  const entries = fixtures ? report.results! : handoff?.success ? [handoff.data] : (report.attempts ?? []);

  if (
    entries.some((row) =>
      fixtures ? row.file === undefined : !legacyHandoff && row.id === undefined && row.recipe === undefined,
    )
  )
    throw new ReportError('Malformed result: missing file, case or recipe identity');
  const completion = regrade
    ? (report.sourceCompletion ?? 'unknown')
    : fixtures
      ? report.passed !== undefined && report.failed !== undefined
        ? 'complete'
        : 'unknown'
      : report.pass !== undefined
        ? 'complete'
        : 'unknown';
  const recorded = fixtures
    ? report.failed === undefined || report.passed === undefined
      ? 'unknown'
      : report.failed
        ? 'fail'
        : 'pass'
    : (report.status ??
      (report.schemaVersion === 1 && report.pass !== undefined ? (report.pass ? 'pass' : 'fail') : 'unknown'));
  const counts = { pass: 0, fail: 0, review_required: 0, not_applicable: 0, unknown: 0 };
  const warnings = new Set<string>();

  if (completion !== 'complete') warnings.add('Missing complete-source evidence; report may be partial.');
  if (!entries.length) warnings.add('No attempts/results recorded; no acceptance established.');
  if (recorded === 'unknown') warnings.add('Final acceptance state is not recorded.');
  if (!legacy && !report.rubricVersion)
    warnings.add('Rubric version is not recorded; no current rubric is substituted.');
  if (report.pass !== undefined && report.status !== undefined && report.pass !== (report.status === 'pass'))
    warnings.add('Recorded pass and status disagree.');
  for (const row of entries) {
    counts[state(row, legacy)]++;
    if (state(row, legacy) === 'pass' && row.diagnostic)
      warnings.add('A recorded passing result contains a failure diagnostic.');
    if (!legacy && !row.criteria?.length) warnings.add('One or more attempts lack criterion evidence.');
    if (!legacy && row.status === undefined) warnings.add('One or more attempts lack a recorded status.');
    if (
      state(row, legacy) === 'pass' &&
      row.criteria?.length &&
      row.criteria.every((c) => c.verdict === 'not_applicable')
    )
      warnings.add('A recorded passing attempt has no applicable criterion evidence.');
    if (row.status !== undefined && row.pass !== undefined && row.pass !== (row.status === 'pass'))
      warnings.add('An attempt has conflicting pass/status fields.');
    if (
      state(row, legacy) === 'pass' &&
      row.criteria?.some((c) => c.verdict === 'fail' || c.verdict === 'review_required')
    )
      warnings.add('A recorded passing attempt contains failed or pending criteria.');
    if (row.criteria?.some((c) => c.expected === undefined || c.actual === undefined))
      warnings.add('One or more criteria lack expected/actual evidence.');
  }
  if (!legacy && recorded === 'pass' && entries.length && counts.not_applicable === entries.length)
    warnings.add('Recorded run pass has no applicable attempt evidence.');
  if (recorded === 'pass' && (counts.fail || counts.review_required || counts.unknown))
    warnings.add('Recorded run pass disagrees with attempt/result states.');
  if (fixtures && (report.passed !== counts.pass || report.failed !== counts.fail))
    warnings.add('Recorded fixture totals disagree with results or are missing.');
  if (
    (report.summary &&
      Object.entries(counts).some(
        ([key, value]) => report.summary![key] !== undefined && report.summary![key] !== value,
      )) ||
    (report.summary?.total !== undefined && report.summary.total !== entries.length)
  )
    warnings.add('Recorded summary disagrees with attempt counts.');
  if (report.repetitions !== undefined) {
    const groups = new Map<string, number[]>();

    for (const row of entries) {
      const key = JSON.stringify([row.id ?? row.recipe, row.mode]);
      const repetitions = groups.get(key) ?? [];

      repetitions.push(row.repetition ?? 0);
      groups.set(key, repetitions);
    }
    if (
      [...groups.values()].some(
        (values) =>
          values.length !== report.repetitions ||
          new Set(values).size !== values.length ||
          values.some((v) => v < 1 || v > report.repetitions!),
      )
    )
      warnings.add('Recorded repetitions are missing, duplicated or outside the declared range.');
  }
  const lines: string[] = [];
  let bytes = 0,
    full = false;
  const end = '[truncated: output limit; remaining detail omitted; inspect the input artifact]\n';
  const line = (text = '') => {
    if (full) return;
    const size = Buffer.byteLength(text) + 1;

    if (bytes + size > OUTPUT_BYTES - Buffer.byteLength(end)) {
      lines.push(end.trimEnd());
      full = true;

      return;
    }
    lines.push(text);
    bytes += size;
  };
  const field = (label: string, value: unknown) => line(`${label}: ${preview(value)}`);
  const fields = (row: Record<string, unknown>, names: string[], prefix = '') => {
    for (const name of names) if (Object.hasOwn(row, name)) field(`${prefix}${name}`, row[name]);
  };
  const reference = (pointer: string) => line(`  artifact: #${pointer}`);
  const usage = (row: Record<string, unknown>, prefix: string) =>
    line(
      prefix +
        ['requests', 'tokens', 'retries', 'repairs', 'cost', 'selectionRecall']
          .map(
            (name) =>
              `${name}: ${row[name] === undefined || row[name] === null || row[name] === 'unknown' ? 'unknown' : preview(row[name])}`,
          )
          .join(' | '),
    );

  line(
    `${regrade ? 'Source completion' : 'Completion'}: ${completion}${completion === 'complete' ? ' (recorded marker; not independently verified)' : ' / possibly partial'}`,
  );
  line(
    `Recorded acceptance: ${recorded}${!fixtures && report.schemaVersion === 1 ? ' (legacy regression/keyword-floor grade; not factual acceptance)' : ''}`,
  );
  line(
    `Acceptance evidence: ${warnings.size ? 'not established or inconsistent; see warnings' : fixtures ? 'fixture contract only' : legacy ? 'legacy floor only; factual acceptance unknown' : 'recorded criteria only; not independently verified'}`,
  );
  line(
    `Format: ${fixtures ? 'extension-fixtures' : regrade ? 'offline-regrade' : legacyHandoff ? 'legacy-handoff' : 'evaluation'} v${report.schemaVersion} | rubric: ${preview(report.rubricVersion)}`,
  );
  line(
    `Recorded attempts/results: ${entries.length} | ${Object.entries(counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')}`,
  );
  for (const warning of warnings) line(`Warning: ${warning}`);
  line(
    'Rendering is not grading or acceptance. Previews may contain private data. References are not opened or verified.',
  );
  if (!fixtures && report.schemaVersion === 1)
    line(
      'Legacy firstPassCorrect and selection false-negative fields do not establish correctness or measured recall.',
    );
  if (regrade)
    line(
      'Historical verdicts below are preserved source verdicts, not necessarily legacy grades. No regrade was performed.',
    );
  field('Input artifact', source);
  line(`Input SHA-256: ${createHash('sha256').update(raw).digest('hex')}`);
  fields(report, ['sourceReport', 'sourceReportSha256']);
  const ordered = entries
    .map((row, index) => ({ row, index }))
    .toSorted((a, b) => priority(a.row, legacy) - priority(b.row, legacy));

  for (const { row, index } of ordered.slice(0, 20)) {
    const pointer = legacyHandoff ? '' : `/${fixtures ? 'results' : 'attempts'}/${index}`;

    line();
    line(
      `${state(row, legacy).toUpperCase()} ${preview(row.file ?? row.id ?? row.recipe ?? 'handoff')} | route ${preview(row.mode)} | repetition ${preview(row.repetition)} | index ${index}`,
    );
    reference(pointer);
    fields(
      row,
      [
        'sourceAttempt',
        'rubricVersion',
        'caseVersion',
        'caseSha256',
        'outputSha256',
        'failure',
        'error',
        'location',
        'message',
        'firstCallValid',
        'firstPassCorrect',
        'factualCorrect',
        'elapsedMs',
        'falseNegativesFromSelection',
        'evidenceRetention',
      ],
      '  ',
    );
    if (row.historical) {
      field('  historical pass (recorded)', row.historical.pass);
      field('  historical failure (recorded)', row.historical.failure);
    }
    usage({ ...row, ...row.stats }, '  ');
    field('  routes (recorded)', row.stats?.routes);
    for (const [i, stage] of (row.stages ?? []).slice(0, 10).entries()) {
      line(`  Stage ${i}: #${pointer}/stages/${i}`);
      field('    routes (recorded)', stage.stats?.routes);
      fields(stage, ['args', 'code'], '    ');
      usage(stage.stats ?? {}, '    ');
    }
    if ((row.stages?.length ?? 0) > 10) line(`  [truncated: ${row.stages!.length - 10} stages omitted]`);
    const criteria = (row.criteria ?? [])
      .map((c, i) => ({ c, i }))
      .toSorted((a, b) => priority({ status: a.c.verdict }, false) - priority({ status: b.c.verdict }, false));

    for (const { c, i } of criteria.slice(0, 10)) {
      line(`  ${preview(c.id)} [${c.layer}]: ${c.verdict}`);
      field('    expected', c.expected);
      field('    actual', c.actual);
      field('    reason', c.reason);
      field('    method', c.method);
      if (!c.evidence?.length) line('    evidence: not recorded');
      for (const evidence of (c.evidence ?? []).slice(0, 2))
        line(`    evidence [${evidence.start},${evidence.end}) (recorded UTF-16 offsets): ${preview(evidence.quote)}`);
      if ((c.evidence?.length ?? 0) > 2) line(`    [truncated: ${c.evidence!.length - 2} evidence spans omitted]`);
      reference(`${pointer}/criteria/${i}`);
    }
    if (criteria.length > 10) line(`  [truncated: ${criteria.length - 10} criteria omitted; see #${pointer}/criteria]`);
    if (!criteria.length && !fixtures) {
      line('  criteria/layers: not recorded; no grades inferred');
      line('  expected: not recorded');
      field('  actual preview', row.final ?? row.answer ?? row.out);
      field('  reason', row.failure);
    }
    if (fixtures) {
      const d = row.diagnostic;

      field('  diagnostic', d?.kind);
      if (d?.kind === 'value-mismatch') {
        for (const name of ['expected', 'actual'] as const) {
          const value = d[name];

          line(`    ${name} type=${preview(value.type)} | recorded truncated=${value.truncated}`);
          field(`    ${name} preview`, value.preview);
        }
      } else if (d?.kind === 'error-mismatch') {
        field('    expected', d.expected);
        field('    actual', d.actual);
      } else line('    expected/actual: not recorded');
      if (d?.kind === 'value-mismatch') {
        field('    mismatch pointer', d.path);
        if (d.pathTruncated) line('    [truncated: recorded mismatch path]');
      }
      reference(`${pointer}/diagnostic`);
    }
  }
  if (entries.length > 20)
    line(`[truncated: ${entries.length - 20} attempts/results omitted; original indices retained above]`);

  line();
  line('Recorded provenance (not independently verified):');
  field('Recorded revision', report.revision);
  field('Recorded binarySha256', report.binarySha256);
  fields(report, [
    'worktreeDirty',
    'build',
    'model',
    'profile',
    'small',
    'strong',
    'modelDigest',
    'harness',
    'reviewsSha256',
    'graderSha256',
    'replaySha256',
    'fixtureSha256',
    'scriptSha256',
    'derivation',
    'summary',
    'thresholds',
    'acceptance',
    'limitations',
  ]);
  for (const name of ['fixtureHashes', 'evaluatorHashes']) {
    const value = report[name];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      field(name, value);
      continue;
    }
    const keys = Object.keys(value).toSorted();

    for (const key of keys.slice(0, 20)) field(`${name}[${preview(key)}]`, (value as Record<string, unknown>)[key]);
    if (keys.length > 20) line(`[truncated: ${keys.length - 20} ${name} entries omitted; see #/${name}]`);
  }

  return lines.join('\n') + '\n';
}

async function readReport(path: string): Promise<string> {
  // Nonblocking open prevents a writerless FIFO from hanging before descriptor validation.
  const file = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK));

  try {
    if (!(await file.stat()).isFile()) throw new ReportError('Input must be a regular report file');
    const chunks: Buffer[] = [];
    let total = 0;

    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, INPUT_BYTES - total + 1));
      const { bytesRead } = await file.read(buffer);

      if (!bytesRead) break;
      total += bytesRead;
      if (total > INPUT_BYTES) throw new ReportError('Report exceeds the 32 MiB input limit');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    } catch {
      throw new ReportError('Report is not valid UTF-8');
    }
  } finally {
    await file.close();
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const help =
      'bun run eval:report -- REPORT.json [--output NEW.txt]\nOffline plain text; exit 0 means rendered, not accepted. Output files must not exist. Previews may contain private data.';

    if (args.length === 1 && args[0] === '--help') console.log(help);
    else {
      if (
        !args[0] ||
        args[0].startsWith('--') ||
        (args.length !== 1 && (args.length !== 3 || args[1] !== '--output' || !args[2] || args[2].startsWith('--')))
      )
        throw new ReportError(help);
      const output = renderReport(await readReport(args[0]), args[0]);

      if (args[2]) await writeFile(args[2], output, { flag: 'wx' });
      else process.stdout.write(output);
    }
  } catch (error) {
    const invalid = error instanceof ReportError;

    process.stderr.write(
      `eval:report: ${invalid ? error.message : 'Cannot read report or create output (output must not already exist)'}\n`,
    );
    process.exitCode = invalid ? 2 : 1;
  }
}
