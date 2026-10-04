import { expect, test } from 'bun:test';
import { resolveCapabilities, validateCapabilities } from '../../src/sdk/capabilities.ts';
import { builtins } from '../../src/catalog/index.ts';
import { routeFor, runInvocation } from '../../src/engine/runtime/index.ts';
import { Budget } from '../../src/sdk/index.ts';
import { configSchema } from '../../src/config/index.ts';
import { planFlow } from '../../src/flows/index.ts';

const objectOnly = configSchema.parse({
  providers: {
    mock: { type: 'ollama', baseUrl: 'http://127.0.0.1:1', defaultModel: 'synthetic', capabilities: ['object'] },
  },
  default: { provider: 'mock' },
});

test('conditional builtin requirements select only the active mode', () => {
  for (const [name, args, expected] of [
    ['map', {}, ['text']],
    ['map', { schema: '' }, ['text']],
    ['map', { schema: 'schema.json', annotate: 'result' }, ['object']],
    ['find', {}, []],
    ['find', { about: '' }, []],
    ['find', { about: 'test' }, ['object']],
    ['tree', { describe: false }, []],
    ['tree', { describe: true }, ['object']],
    ['tree', { about: 'test' }, ['object']],
    ['pick', {}, []],
    ['pick', { about: 'test' }, ['object']],
  ] as const) {
    expect(resolveCapabilities(builtins[name].actions.run, args)).toEqual({
      status: expected.length ? 'semantic' : 'exact',
      capabilities: [...expected],
    });
    if (name !== 'map') {
      const invocation = { name, manifest: builtins[name], action: 'run', args, config: {} };

      expect(routeFor(invocation, objectOnly)?.provider).toBe(expected.length ? 'mock' : undefined);
      if (expected.length) expect(() => routeFor(invocation, configSchema.parse({}))).toThrow('No complete route');
    }
  }
});

test('selectors use defaults, false overrides, and explicit unknowns rather than reference truthiness', () => {
  const action = {
    ...builtins.tree.actions.run,
    args: { type: 'object', properties: { describe: { type: 'boolean', default: true } } },
  };

  expect(resolveCapabilities(action, {})).toEqual({ status: 'semantic', capabilities: ['object'] });
  expect(resolveCapabilities(action, { describe: false })).toEqual({ status: 'exact', capabilities: [] });
  expect(resolveCapabilities(action, { describe: { $ref: 'input.describe' } }, new Set(['describe']))).toEqual({
    status: 'unresolved',
    arguments: ['describe'],
  });
  expect(
    resolveCapabilities(action, { about: 'known', describe: { $ref: 'input.describe' } }, new Set(['describe'])),
  ).toEqual({ status: 'semantic', capabilities: ['object'] });
});

test('invalid declarative selectors and capabilities are rejected', () => {
  const args = builtins.tree.actions.run.args;

  for (const value of [
    ['invented'],
    { whenAny: [], ifTrue: ['object'], ifFalse: [] },
    { whenAny: ['missing'], ifTrue: ['object'], ifFalse: [] },
    { whenAny: ['depth'], ifTrue: ['object'], ifFalse: [] },
    { whenAny: ['describe', 'describe'], ifTrue: ['object'], ifFalse: [] },
    { whenAny: ['describe'], ifTrue: ['object'] },
    { whenAny: ['describe'], ifTrue: ['object'], ifFalse: [], extra: true },
  ])
    expect(() => validateCapabilities(value, args)).toThrow();
});

test('runtime rejects an implementation call outside its selected declaration before a request', async () => {
  const budget = new Budget();
  const manifest = { ...builtins.map, actions: { run: { ...builtins.map.actions.run, capabilities: ['object'] } } };

  try {
    const output = await runInvocation(
      { name: 'map', manifest, action: 'run', args: { instruction: 'Synthetic transformation' }, config: {} },
      {
        kind: 'records',
        records: (async function* () {
          yield { id: '1', value: 'Synthetic evidence', annotations: {} };
        })(),
      },
      budget,
      objectOnly,
    );

    expect(output.kind).toBe('records');
    if (output.kind === 'records')
      await expect(Array.fromAsync(output.records)).rejects.toThrow('map/run did not declare text');
    expect(budget.requests).toBe(0);
  } finally {
    budget.close();
  }
});

test('flow planning defers referenced selectors but retains known requirements and defaults', async () => {
  const raw = {
    apiVersion: 'ribbit/v1',
    kind: 'Flow',
    name: 'conditional',
    input: {
      type: 'object',
      properties: { describe: { type: 'boolean' }, instruction: { type: 'string' } },
      additionalProperties: false,
    },
    steps: [{ id: 'tree', command: 'tree', args: { describe: { $ref: 'input.describe' } } }],
  };
  const plan = await planFlow(raw, configSchema.parse({}));

  expect(plan.steps[0].inference).toEqual({
    status: 'unresolved',
    arguments: ['describe'],
    references: ['input.describe'],
  });
  expect(plan.steps[0].route).toBeNull();
  expect(plan.steps[0].invocation.args.root).toBe('.');
  const known = await planFlow(
    {
      ...raw,
      steps: [
        {
          id: 'map',
          command: 'map',
          args: { instruction: { $ref: 'input.instruction' }, schema: 'schema.json' },
          input: [],
        },
      ],
    },
    objectOnly,
  );

  expect(known.steps[0].inference).toEqual({ status: 'semantic', capabilities: ['object'] });
  expect(known.steps[0].route).toMatchObject({ provider: 'mock' });
  const either = await planFlow(
    {
      ...raw,
      steps: [{ id: 'tree', command: 'tree', args: { about: 'known', describe: { $ref: 'input.describe' } } }],
    },
    objectOnly,
  );

  expect(either.steps[0].inference).toEqual({ status: 'semantic', capabilities: ['object'] });
});
