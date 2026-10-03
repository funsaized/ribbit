import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import {
  z,
  defineCommand,
  defineAction,
  jsonValueSchema,
  recordSchema,
  RibbitError,
  type Action,
  type RecordValue,
} from '../sdk/index.ts';
import { walk } from '../filesystem/index.ts';
import { collect, textFile, recordField, recordPathParts, prompt } from './primitives.ts';
import { semanticCommands } from './semantic.ts';
import { executeAction } from '../sdk/index.ts';

const config = z.strictObject({});
const traversal = {
  root: z.string().default('.'),
  hidden: z.boolean().default(false),
  noIgnore: z.boolean().default(false),
  follow: z.boolean().default(false),
  outsideRoot: z.boolean().default(false),
  includeSensitive: z.boolean().default(false),
  glob: z.string().optional(),
  maxFiles: z.number().int().positive().optional(),
  onReadError: z.enum(['error', 'skip']).default('error'),
};

function command(
  name: string,
  description: string,
  args: z.ZodType,
  execute: Action['execute'],
  options: Partial<Action> = {},
) {
  return defineCommand({
    type: `@ribbit/${name}`,
    version: '1.0.0',
    description,
    config,
    actions: {
      run: defineAction({
        config,
        description,
        args,
        input: jsonValueSchema,
        output: z.array(recordSchema),
        mode: 'value',
        inputKind: 'none',
        outputKind: 'records',
        capabilities: [],
        effects: ['filesystem-read'],
        execute,
        ...options,
      } as Action),
    },
  });
}

async function about(rows: RecordValue[], instruction: string, ctx: any) {
  if (!rows.length) return rows;
  const result = await ctx.llm.object(
    prompt(`Select relevant candidate IDs for: ${instruction}. Return only supplied IDs.`),
    JSON.stringify(rows.map((r) => ({ id: r.id, value: r.value }))),
    z.strictObject({ ids: z.array(z.string()) }),
  );

  if (new Set(result.ids).size !== result.ids.length || result.ids.some((id: string) => !rows.some((r) => r.id === id)))
    throw new RibbitError(4, 'Semantic filesystem output contains invalid IDs');

  return rows.filter((r) => result.ids.includes(r.id));
}

export function pickerSelections(selected: string, rows: RecordValue[]): RecordValue[] {
  const chosen: RecordValue[] = [],
    ids = new Set<number>();

  for (const item of selected.split('\0').filter(Boolean)) {
    const token = item.split('\t', 1)[0];

    if (!/^(0|[1-9]\d*)$/.test(token)) throw new RibbitError(7, 'Invalid picker identity');
    const id = Number(token);

    if (!rows[id] || ids.has(id) || !item.startsWith(`${id}\t`)) throw new RibbitError(7, 'Invalid picker selection');
    ids.add(id);
    chosen.push(rows[id]);
  }

  return chosen;
}

export const filesystemCommands = {
  ls: command(
    'ls',
    'List actual filesystem metadata without inference',
    z.strictObject({ ...traversal, recursive: z.boolean().default(false) }),
    async ({ args }, ctx) =>
      walk((args as any).root, { ...(args as any), maxBytes: ctx.budget.limits.maxBytes }, ctx.log),
    { cli: { positionals: ['root'] } },
  ),
  read: command(
    'read',
    'Read explicit UTF-8 files with source boundaries',
    z.strictObject({ paths: z.array(z.string()).min(1) }),
    async ({ args }, ctx) => {
      const result: RecordValue[] = [];
      let bytes = 0;

      for (const path of (args as any).paths) {
        const content = await textFile(path, ctx.budget.limits.maxBytes - bytes);

        bytes += Buffer.byteLength(content);
        result.push({
          id: String(result.length + 1),
          value: { path: resolve(path), content },
          source: { path: resolve(path) },
          annotations: {},
        });
      }

      return result;
    },
    { cli: { positionals: ['paths'] } },
  ),
  find: command(
    'find',
    'Find real filesystem candidates with optional semantic filtering',
    z.strictObject({
      ...traversal,
      kind: z.enum(['file', 'directory', 'symlink', 'other']).optional(),
      about: z.string().optional(),
      read: z.enum(['names', 'content']).default('names'),
    }),
    async ({ args }, ctx) => {
      const a = args as any,
        rows = await walk(
          a.root,
          { ...a, maxBytes: ctx.budget.limits.maxBytes, recursive: true, semantic: !!a.about },
          ctx.log,
        );

      return a.about ? about(rows, a.about, ctx) : rows;
    },
    { cli: { positionals: ['root'] }, capabilities: { whenAny: ['about'], ifTrue: ['object'], ifFalse: [] } },
  ),
  tree: command(
    'tree',
    'Render filesystem topology with optional semantic annotations',
    z.strictObject({
      ...traversal,
      depth: z.number().int().nonnegative().default(3),
      describe: z.boolean().default(false),
      about: z.string().optional(),
      read: z.enum(['names', 'content']).default('names'),
    }),
    async ({ args }, ctx) => {
      const a = args as any;
      let rows =
        a.depth === 0
          ? []
          : await walk(
              a.root,
              {
                ...a,
                maxBytes: ctx.budget.limits.maxBytes,
                recursive: true,
                glob: undefined,
                semantic: !!a.about || a.describe,
              },
              ctx.log,
            );

      if (a.glob) {
        const matches = rows.filter((r) => new Bun.Glob(a.glob).match((r.value as any).relativePath)),
          paths = new Set<string>();

        for (const r of matches) {
          let p = (r.value as any).path;

          while (p !== resolve(a.root)) {
            paths.add(p);
            const parent = dirname(p);

            if (parent === p) break;
            p = parent;
          }
        }
        rows = rows.filter((r) => paths.has((r.value as any).path));
      }
      if (a.about) {
        const selected = await about(rows, a.about, ctx),
          paths = new Set<string>();

        for (const r of selected) {
          let p = (r.value as any).path;

          while (p !== resolve(a.root)) {
            paths.add(p);
            const parent = dirname(p);

            if (parent === p) break;
            p = parent;
          }
        }
        rows = rows.filter((r) => paths.has((r.value as any).path));
      }
      let descriptions: Record<string, string> = {};

      if (a.describe && rows.length) {
        const result = await ctx.llm.object(
          prompt(
            `Describe every supplied candidate briefly, using ${a.read === 'content' ? 'supplied file content' : 'names only'} as evidence. Do not invent paths or claim content was read when absent.`,
          ),
          JSON.stringify(rows.map((r) => ({ id: r.id, value: r.value }))),
          z.strictObject({ descriptions: z.array(z.strictObject({ id: z.string(), text: z.string() })) }),
        );

        if (
          result.descriptions.length !== rows.length ||
          new Set(result.descriptions.map((d) => d.id)).size !== rows.length ||
          result.descriptions.some((d) => !rows.some((r) => r.id === d.id))
        )
          throw new RibbitError(4, 'Tree descriptions must match candidate IDs');
        descriptions = Object.fromEntries(result.descriptions.map((d) => [d.id, d.text]));
      }

      return {
        root: resolve(a.root),
        evidence: a.describe ? a.read : 'metadata',
        nodes: rows.map((r) => ({
          ...r,
          ...(descriptions[r.id]
            ? { annotations: { tree: { description: descriptions[r.id], evidence: a.read } } }
            : {}),
        })),
      };
    },
    {
      cli: { positionals: ['root'] },
      output: jsonValueSchema,
      outputKind: 'display',
      capabilities: { whenAny: ['about', 'describe'], ifTrue: ['object'], ifFalse: [] },
    },
  ),
  pick: command(
    'pick',
    'Select original records using fzf on the controlling terminal',
    z.strictObject({
      multi: z.boolean().default(false),
      query: z.string().default(''),
      about: z.string().optional(),
      label: z.string().optional(),
    }),
    async function* ({ args, input }, ctx) {
      const a = args as any;

      if (a.label !== undefined) recordPathParts(a.label);
      let tty;

      try {
        tty = await open(
          process.platform === 'win32' ? 'CONOUT$' : '/dev/tty',
          process.platform === 'win32' ? 'w' : 'r+',
        );
      } catch {
        throw new RibbitError(7, 'pick requires a controlling terminal; use rank --top for noninteractive selection');
      }
      try {
        let rows = await collect(input as AsyncIterable<unknown>, ctx.budget.limits.maxRecords);

        if (!rows.length) return;
        if (a.about) {
          const ranked = await executeAction(
            semanticCommands.rank.actions.run,
            (async function* () {
              yield* rows;
            })(),
            { instruction: a.about },
            {},
            ctx,
          );

          rows = await collect(ranked as AsyncIterable<unknown>, 200);
        }
        const version = Bun.spawn(['fzf', '--version'], { stdout: 'pipe', stderr: 'pipe' });

        if ((await version.exited) !== 0) throw new RibbitError(7, 'Install fzf >=0.74.3');
        const output = await new Response(version.stdout).text();
        const numbers = output.split(' ')[0].split('.').map(Number);

        if (numbers[0] === 0 && (numbers[1] < 74 || (numbers[1] === 74 && numbers[2] < 3)))
          throw new RibbitError(7, 'Install fzf >=0.74.3');
        // eslint-disable-next-line no-control-regex -- intentional: escapes control characters for fzf
        const labels = rows
          .map((r, i) => {
            const value = a.label !== undefined ? recordField(r, a.label) : r.value;
            const display = typeof value === 'string' ? value : JSON.stringify(value);

            return `${i}\t${display.replace(/[\u0000-\u001f\u007f]/g, (c: string) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\0`;
          })
          .join('');
        const env: Record<string, string | undefined> = {
          ...process.env,
          FZF_DEFAULT_OPTS: '',
          FZF_DEFAULT_COMMAND: '',
        };

        delete env.FZF_DEFAULT_OPTS_FILE;
        const pickerProcess = Bun.spawn(
          [
            'fzf',
            '--read0',
            '--print0',
            '--delimiter=\t',
            '--with-nth=2..',
            '--query',
            a.query,
            ...(a.multi ? ['--multi'] : []),
          ],
          { stdin: new Blob([labels]), stdout: 'pipe', stderr: tty.fd, env },
        );
        const abort = () => pickerProcess.kill('SIGINT');

        ctx.signal.addEventListener('abort', abort, { once: true });
        let selected: string, exit: number;

        try {
          selected = await new Response(pickerProcess.stdout).text();
          exit = await pickerProcess.exited;
        } finally {
          ctx.signal.removeEventListener('abort', abort);
        }
        if (exit === 130) throw new RibbitError(130, 'Picker cancelled');
        if (exit === 1) return;
        if (exit !== 0) throw new RibbitError(7, 'fzf backend failed');
        for (const row of pickerSelections(selected, rows)) yield row;
      } finally {
        await tty.close();
      }
    },
    {
      mode: 'records',
      input: recordSchema,
      output: recordSchema,
      inputKind: 'records',
      outputKind: 'records',
      capabilities: { whenAny: ['about'], ifTrue: ['object'], ifFalse: [] },
      effects: ['process', 'terminal'],
      barrier: true,
    },
  ),
};
