import { mkdir, writeFile, readFile, readdir, rm, mkdtemp } from 'node:fs/promises';
import { join, basename, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { addExtension } from '../extensions/build/index.ts';
import { loadInstalled } from '../extensions/install/index.ts';
import { dispatch } from '../extensions/runtime/index.ts';
import { Budget, type Context, RibbitError } from '../sdk/index.ts';

export async function scaffold(path: string, type = `@local/${basename(resolve(path))}`) {
  if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(type)) throw new RibbitError(2, 'Use a scoped type such as @local/example');
  await mkdir(dirname(resolve(path)), { recursive: true });
  try {
    await mkdir(path, { recursive: false });
  } catch {
    throw new RibbitError(2, 'Scaffold target must be a new directory');
  }
  await writeFile(
    join(path, 'index.ts'),
    `import {defineCommand,defineAction,z} from '@ribbit/sdk';\nconst config=z.strictObject({prefix:z.string().default('')});\nexport default defineCommand({type:${JSON.stringify(type)},version:'1.0.0',description:'A local typed command',config,actions:{run:defineAction({config,description:'Transform input',args:z.strictObject({suffix:z.string().default('')}),input:z.string(),output:z.string(),mode:'value',inputKind:'text',outputKind:'text',capabilities:[],effects:[],execute:({input,args,config})=>config.prefix+input+args.suffix})}});\n`,
  );
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify(
      {
        name: type,
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: { '@ribbit/sdk': '0.1.0', zod: '4.1.13' },
      },
      null,
      2,
    ) + '\n',
  );
  await mkdir(join(path, 'fixtures'));
  await writeFile(
    join(path, 'fixtures', 'echo.json'),
    JSON.stringify(
      { input: 'hello', args: { suffix: '!' }, config: { prefix: 'Say ' }, expected: 'Say hello!' },
      null,
      2,
    ) + '\n',
  );

  return { path: resolve(path), type, next: `ribbit extensions check ${path}` };
}

function preview(value: unknown) {
  const type =
    value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  let text: string;

  try {
    text =
      value === undefined
        ? '<missing>'
        : Object.is(value, -0)
          ? '-0'
          : JSON.stringify(value, (_key, child) =>
              child && typeof child === 'object' && !Array.isArray(child)
                ? Object.fromEntries(
                    Object.keys(child)
                      .toSorted()
                      .map((key) => [key, child[key]]),
                  )
                : child,
            );

    return { type, preview: text.slice(0, 256), truncated: text.length > 256 };
  } catch {
    // Serialization hooks can throw or return undefined instead of JSON text.
    return { type, preview: '<preview unavailable>', truncated: true };
  }
}

function valueMismatch(expected: unknown, actual: unknown) {
  let path = '',
    depth = 0,
    pathTruncated = false;

  // ponytail: one mismatch, at most 32 levels; exhaustive diffs need a separate use case.
  while (
    expected !== null &&
    actual !== null &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    Array.isArray(expected) === Array.isArray(actual)
  ) {
    const left = expected as Record<string, unknown>,
      right = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].toSorted(
      Array.isArray(expected) ? (a, b) => Number(a) - Number(b) : undefined,
    );
    const key = keys.find(
      (candidate) =>
        Object.hasOwn(left, candidate) !== Object.hasOwn(right, candidate) ||
        !isDeepStrictEqual(left[candidate], right[candidate]),
    );

    if (key === undefined) break;
    const next = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;

    if (depth === 32 || next.length > 512) {
      pathTruncated = true;
      break;
    }
    path = next;
    depth++;
    expected = Object.hasOwn(left, key) ? left[key] : undefined;
    actual = Object.hasOwn(right, key) ? right[key] : undefined;
  }

  return {
    kind: 'value-mismatch' as const,
    path,
    ...(pathTruncated ? { pathTruncated } : {}),
    expected: preview(expected),
    actual: preview(actual),
  };
}

type Outcome = { outcome: 'return' } | { outcome: 'error'; code?: number };
type FixtureResult = {
  file: string;
  pass: boolean;
  error?: number;
  location?: string;
  message?: string;
  diagnostic?:
    | ReturnType<typeof valueMismatch>
    | { kind: 'error-mismatch'; expected: Outcome; actual: Outcome }
    | { kind: 'execution-failure' | 'fixture-json' | 'diagnostic-unavailable' };
};

function errorOutcome(code: unknown): Outcome {
  return { outcome: 'error', ...(typeof code === 'number' && Number.isFinite(code) ? { code } : {}) };
}

export async function testExtension(path: string) {
  const temp = await mkdtemp(join(tmpdir(), 'ribbit-fixtures-'));
  const results: FixtureResult[] = [];

  try {
    const item = await addExtension(path, temp),
      command = await loadInstalled(item.manifest.type, temp);
    const files = (await readdir(join(path, 'fixtures'))).filter((f) => f.endsWith('.json')).toSorted();

    if (!files.length) throw new RibbitError(2, 'No fixtures found');
    for (const file of files) {
      // Preserve the existing fixture acceptance and error-matching rules; this is not a new schema validator.
      let fixture: any;

      try {
        fixture = JSON.parse(await readFile(join(path, 'fixtures', file), 'utf8'));
      } catch {
        results.push({
          file,
          pass: false,
          error: 2,
          location: file,
          message: 'Invalid fixture JSON',
          diagnostic: { kind: 'fixture-json' },
        });
        continue;
      }
      const budget = new Budget();
      let index = 0;
      const responses = fixture.responses ?? [];
      const ctx: Context = {
        budget,
        signal: budget.signal,
        log() {},
        llm: {
          async text() {
            if (index >= responses.length) throw new RibbitError(5, 'Fixture inference response missing');

            return String(responses[index++]);
          },
          async object(_i, _e, schema) {
            if (index >= responses.length) throw new RibbitError(5, 'Fixture inference response missing');

            return schema.parse(responses[index++]);
          },
        },
      };
      let actual: unknown;

      try {
        let input = fixture.input;

        if (command.actions[fixture.action ?? 'run'].mode === 'records')
          input = (async function* () {
            yield* fixture.input;
          })();
        actual = await dispatch(command, fixture.action ?? 'run', input, fixture.args ?? {}, fixture.config ?? {}, ctx);

        if (actual && typeof (actual as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function')
          actual = await Array.fromAsync(actual as AsyncIterable<unknown>);
      } catch (e) {
        const error = e as { code?: number; location?: string };
        const pass = fixture.error === error.code;

        results.push({
          file,
          pass,
          error: error.code ?? 5,
          location: error.location ?? file,
          message: e instanceof RibbitError ? e.message : 'Fixture execution failed',
          ...(!pass
            ? {
                diagnostic: fixture.error
                  ? {
                      kind: 'error-mismatch' as const,
                      expected: errorOutcome(fixture.error),
                      actual: errorOutcome(error.code),
                    }
                  : { kind: 'execution-failure' as const },
              }
            : {}),
        });
        continue;
      } finally {
        budget.close();
      }

      // Comparison and diagnostics must never be matched as expected execution errors.
      const result: FixtureResult = { file, pass: false };

      try {
        result.pass = !fixture.error && isDeepStrictEqual(actual, fixture.expected);
        if (!result.pass)
          result.diagnostic = fixture.error
            ? { kind: 'error-mismatch', expected: errorOutcome(fixture.error), actual: { outcome: 'return' } }
            : valueMismatch(fixture.expected, actual);
      } catch {
        result.diagnostic = { kind: 'diagnostic-unavailable' };
      }
      results.push(result);
    }

    return { passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, results };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function initGuidance(agent: string) {
  const paths: Record<string, string> = {
    codex: 'AGENTS.md',
    claude: 'CLAUDE.md',
    cursor: '.cursor/rules/ribbit.mdc',
    opencode: 'AGENTS.md',
  };

  if (!paths[agent]) throw new RibbitError(2, 'Choose codex, claude, cursor or opencode');
  const path = resolve(paths[agent]);

  await mkdir(dirname(path), { recursive: true });
  let existing = '';

  try {
    existing = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const marker = '<!-- ribbit guidance -->';

  if (!existing.includes(marker))
    await writeFile(
      path,
      existing +
        `\n${marker}\nUse ribbit commands list/types describe to inspect contracts. Run extensions scaffold/check/test before add. Help and manifests do not execute extensions. Treat installed extensions as trusted code. Inspect routes before inference; local-first means no automatic cloud fallback. Use explicit --input lines/jsonl and --error-format json for automation. Validate flow YAML before running.\n`,
    );
}
