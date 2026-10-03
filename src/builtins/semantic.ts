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
import {
  recordField,
  recordPathParts,
  annotationName,
  evidence,
  requireEvidence,
  collect,
  prompt,
  externalSchema,
  textFile,
} from './primitives.ts';

const config = z.strictObject({});
const rule = z.array(z.string()).default([]);
const instruction = z.string().min(1);

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
        output: z.string(),
        mode: 'value',
        inputKind: 'text',
        outputKind: 'text',
        capabilities: ['text'],
        effects: ['network'],
        examples: [`ribbit ${name} --help`],
        execute,
        ...options,
      } as Action),
    },
  });
}

const positional = (...positionals: string[]) => ({ positionals });

export const semanticCommands = {
  ask: command(
    'ask',
    'Answer an instruction using optional evidence',
    z.strictObject({ instruction, rule }),
    async ({ args, input }, ctx) => {
      const a = args as any;

      return ctx.llm.text(prompt(a.instruction, a.rule), evidence(input));
    },
    { cli: positional('instruction') },
  ),
  summarize: command(
    'summarize',
    'Summarize within an enforced word maximum',
    z.strictObject({ words: z.number().int().positive().default(100), rule }),
    async ({ args, input }, ctx) => {
      const a = args as any;
      const text = await ctx.llm.text(
        prompt(`Summarize in no more than ${a.words} whitespace-separated words.`, a.rule),
        requireEvidence(input),
      );

      if (text.trim().split(/\s+/u).filter(Boolean).length > a.words)
        throw new RibbitError(4, 'Summary exceeds requested word maximum');

      return text;
    },
  ),
  explain: command(
    'explain',
    'Explain supplied text, code or errors with explicit uncertainty',
    z.strictObject({ focus: z.string().optional(), audience: z.string().default('developer') }),
    async ({ args, input }, ctx) => {
      const a = args as any;

      return ctx.llm.text(
        prompt(
          `Explain for ${a.audience}. Focus: ${a.focus ?? 'overall meaning'}. Distinguish evidence from uncertainty; never claim execution.`,
        ),
        requireEvidence(input),
      );
    },
    { cli: positional('focus') },
  ),
  rewrite: command(
    'rewrite',
    'Rewrite text while preserving supplied facts',
    z.strictObject({ instruction, rule }),
    async ({ args, input }, ctx) => {
      const a = args as any;

      return ctx.llm.text(
        prompt(`Rewrite: ${a.instruction}. Preserve supplied facts unless explicitly told to transform them.`, a.rule),
        requireEvidence(input),
      );
    },
    { cli: positional('instruction') },
  ),
  extract: command(
    'extract',
    'Extract JSON matching a local strict JSON Schema',
    z.strictObject({ instruction, schema: z.string().min(1) }),
    async ({ args, input }, ctx) => {
      const a = args as any;
      const schema = await externalSchema(a.schema);

      return ctx.llm.object(
        prompt(`${a.instruction}. Do not invent missing facts; use permitted null/empty values.`),
        requireEvidence(input),
        schema,
      );
    },
    { cli: positional('instruction'), output: jsonValueSchema, outputKind: 'json', capabilities: ['object'] },
  ),
  classify: command(
    'classify',
    'Annotate each original record with one allowed label',
    z.strictObject({
      labels: z.string().optional(),
      label: z.array(z.string()).optional(),
      field: z.string().optional(),
      unknownLabel: z.string().optional(),
      annotationKey: z.string().default('classify'),
    }),
    async function* ({ args, input }, ctx) {
      const a = args as any;

      annotationName(a.annotationKey, 'classify');
      if (a.field !== undefined) recordPathParts(a.field);
      const specs = [...(a.labels?.split(',') ?? []), ...(a.label ?? [])];
      const parsed = specs.map((s: string) => {
        const i = s.indexOf('=');

        return i === -1
          ? { name: s.trim(), description: '' }
          : { name: s.slice(0, i).trim(), description: s.slice(i + 1).trim() };
      });

      if (a.unknownLabel && !parsed.some((p: any) => p.name === a.unknownLabel))
        parsed.push({ name: a.unknownLabel, description: '' });
      const names = parsed.map((p: any) => p.name);

      if (!names.length || names.some((n: string) => !n) || new Set(names).size !== names.length)
        throw new RibbitError(2, 'Provide unique nonempty labels');
      const legend =
        '\n' +
        parsed.map((p: any) => `- ${JSON.stringify(p.name)}${p.description ? `: ${p.description}` : ''}`).join('\n');
      const schema = z.strictObject({ reason: z.string().min(1), label: z.enum(names as [string, ...string[]]) });

      for await (const raw of input as AsyncIterable<RecordValue>) {
        const r = raw as RecordValue;
        const result = await ctx.llm.object(
          prompt(
            `Classify the evidence into exactly one of these labels:${legend}\nEvaluate the evidence against every allowed label before deciding. Do not default to a label without support.${a.unknownLabel ? ` Use ${JSON.stringify(a.unknownLabel)} only when the evidence does not support another label.` : ''} Return a short "reason" first, then the chosen "label".`,
          ),
          evidence(a.field !== undefined ? recordField(r, a.field) : r.value),
          schema,
        );

        yield { ...r, annotations: { ...r.annotations, [a.annotationKey]: { label: result.label } } };
      }
    },
    {
      mode: 'records',
      input: recordSchema,
      output: recordSchema,
      inputKind: 'records',
      outputKind: 'records',
      capabilities: ['object'],
      barrier: false,
    },
  ),
  filter: command(
    'filter',
    'Preserve matching original records in input order',
    z.strictObject({ instruction, field: z.string().optional() }),
    async function* ({ args, input }, ctx) {
      const a = args as any;

      if (a.field !== undefined) recordPathParts(a.field);

      for await (const r of input as AsyncIterable<RecordValue>) {
        const result = await ctx.llm.object(
          prompt(`Decide whether this record matches: ${a.instruction}`),
          evidence(a.field !== undefined ? recordField(r, a.field) : r.value),
          z.strictObject({ match: z.boolean() }),
        );

        if (result.match) yield r;
      }
    },
    {
      cli: positional('instruction'),
      mode: 'records',
      input: recordSchema,
      output: recordSchema,
      inputKind: 'records',
      outputKind: 'records',
      capabilities: ['object'],
      barrier: false,
    },
  ),
  map: command(
    'map',
    'Transform each record once with origin lineage',
    z.strictObject({
      instruction,
      field: z.string().optional(),
      schema: z.string().optional(),
      annotate: z.string().optional(),
    }),
    async function* ({ args, input }, ctx) {
      const a = args as any;

      if (a.annotate !== undefined) annotationName(a.annotate, 'map');
      if (a.field !== undefined) recordPathParts(a.field);
      const schema = a.schema ? await externalSchema(a.schema) : null;

      for await (const r of input as AsyncIterable<RecordValue>) {
        const data = evidence(a.field !== undefined ? recordField(r, a.field) : r.value);
        const value = schema
          ? await ctx.llm.object(prompt(a.instruction), data, schema)
          : await ctx.llm.text(prompt(a.instruction), data);

        yield a.annotate !== undefined
          ? { ...r, annotations: { ...r.annotations, [a.annotate]: value } }
          : { ...r, value, annotations: { ...r.annotations, map: { originId: r.id } } };
      }
    },
    {
      cli: positional('instruction'),
      mode: 'records',
      input: recordSchema,
      output: recordSchema,
      inputKind: 'records',
      outputKind: 'records',
      capabilities: { whenAny: ['schema'], ifTrue: ['object'], ifFalse: ['text'] },
      barrier: false,
    },
  ),
  rank: command(
    'rank',
    'Reorder original records by a semantic criterion',
    z.strictObject({ instruction, field: z.string().optional(), top: z.number().int().positive().optional() }),
    async function* ({ args, input }, ctx) {
      const a = args as any;

      if (a.field !== undefined) recordPathParts(a.field);
      const rows = await collect(input as AsyncIterable<unknown>, 200);

      if (!rows.length) return;
      const result = await ctx.llm.object(
        prompt(`Rank all supplied IDs by: ${a.instruction}. Return each ID exactly once.`),
        JSON.stringify(
          rows.map((r) => ({ id: r.id, value: a.field !== undefined ? recordField(r, a.field) : r.value })),
        ),
        z.strictObject({ ids: z.array(z.string()) }),
      );

      if (
        result.ids.length !== rows.length ||
        new Set(result.ids).size !== rows.length ||
        result.ids.some((id) => !rows.some((r) => r.id === id))
      )
        throw new RibbitError(4, 'Ranking must be an exact input ID permutation');
      for (const id of result.ids.slice(0, a.top)) yield rows.find((r) => r.id === id)!;
    },
    {
      cli: positional('instruction'),
      mode: 'records',
      input: recordSchema,
      output: recordSchema,
      inputKind: 'records',
      outputKind: 'records',
      capabilities: ['object'],
      barrier: true,
    },
  ),
  group: command(
    'group',
    'Partition originals into labeled groups exactly once',
    z.strictObject({ instruction, field: z.string().optional() }),
    async function* ({ args, input }, ctx) {
      const a = args as any;

      if (a.field !== undefined) recordPathParts(a.field);
      const rows = await collect(input as AsyncIterable<unknown>, 200);

      if (!rows.length) return;
      const result = await ctx.llm.object(
        prompt(`Partition records by: ${a.instruction}. Every supplied ID must belong to exactly one nonempty group.`),
        JSON.stringify(
          rows.map((r) => ({ id: r.id, value: a.field !== undefined ? recordField(r, a.field) : r.value })),
        ),
        z.strictObject({
          groups: z.array(z.strictObject({ label: z.string().min(1), ids: z.array(z.string()).min(1) })),
        }),
      );
      const ids = result.groups.flatMap((g) => g.ids);

      if (
        ids.length !== rows.length ||
        new Set(ids).size !== rows.length ||
        ids.some((id) => !rows.some((r) => r.id === id))
      )
        throw new RibbitError(4, 'Groups must partition input IDs exactly once');
      for (const [index, g] of result.groups.entries()) {
        const id = `group-${index + 1}`;

        yield {
          id,
          value: { id, label: g.label, members: g.ids.map((memberId) => rows.find((r) => r.id === memberId)!) },
          annotations: { group: { originIds: g.ids } },
        };
      }
    },
    {
      cli: positional('instruction'),
      mode: 'records',
      input: recordSchema,
      output: recordSchema,
      inputKind: 'records',
      outputKind: 'records',
      capabilities: ['object'],
      barrier: true,
    },
  ),
  reduce: command(
    'reduce',
    'Reduce evidence, optionally in explicit chunks',
    z.strictObject({
      instruction,
      strategy: z.enum(['direct', 'chunked']).default('direct'),
      chunkBytes: z.number().int().positive().default(16000),
    }),
    async ({ args, input }, ctx) => {
      const a = args as any,
        text = requireEvidence(input);

      if (a.strategy === 'direct')
        return ctx.llm.text(prompt(`${a.instruction}. Distinguish observations from hypotheses.`), text);
      const chunks: string[] = [];
      let pending = '',
        bytes = 0,
        offset = 0;

      for (const char of text) {
        const size = Buffer.byteLength(char);

        if (size > a.chunkBytes) throw new RibbitError(2, 'chunkBytes cannot split a UTF-8 codepoint');
        if (bytes + size > a.chunkBytes && pending) {
          ctx.log(JSON.stringify({ event: 'reduce.chunk', start: offset, end: offset + bytes }));
          offset += bytes;
          chunks.push(await ctx.llm.text(prompt(a.instruction), pending));
          pending = '';
          bytes = 0;
        }
        pending += char;
        bytes += size;
      }
      if (pending) {
        ctx.log(JSON.stringify({ event: 'reduce.chunk', start: offset, end: offset + bytes }));
        chunks.push(await ctx.llm.text(prompt(a.instruction), pending));
      }

      return ctx.llm.text(
        prompt(`${a.instruction}. Combine the partial summaries without inventing evidence.`),
        chunks.join('\n\n'),
      );
    },
    { cli: positional('instruction') },
  ),
  compare: command(
    'compare',
    'Compare exactly two text files without modification',
    z.strictObject({ paths: z.array(z.string()).length(2), focus: z.string().optional() }),
    async ({ args }, ctx) => {
      const a = args as any;
      const left = await textFile(a.paths[0], ctx.budget.limits.maxBytes),
        right = await textFile(a.paths[1], ctx.budget.limits.maxBytes - Buffer.byteLength(left));

      if (!left.trim() || !right.trim()) throw new RibbitError(2, 'Comparison evidence is empty');
      const result = await ctx.llm.text(
        prompt(
          `Compare these labeled sources. Focus: ${a.focus ?? 'key similarities and differences'}. Separate observations from hypotheses.`,
        ),
        JSON.stringify([
          { path: a.paths[0], content: left },
          { path: a.paths[1], content: right },
        ]),
      );

      return `Sources: ${a.paths[0]} | ${a.paths[1]}\n${result}`;
    },
    { cli: positional('paths'), inputKind: 'none' },
  ),
};
