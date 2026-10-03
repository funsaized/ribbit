import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addExtension } from '../../src/extensions/build/index.ts';
import { listInstalled, loadInstalled, removeInstalled } from '../../src/extensions/install/index.ts';
import { hash } from '../../src/sdk/manifest/index.ts';

test('explicit build/install, dormant inspection, stale hash, rollback and source-preserving remove', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ribbit-ext-test-')),
    home = join(dir, 'installed'),
    source = join(dir, 'source');
  const { mkdir } = await import('node:fs/promises');

  await mkdir(source);
  const code = `import {defineCommand,defineAction,z} from '@ribbit/sdk';\nconst config=z.strictObject({});\nexport default defineCommand({type:'@test/echo',version:'1.0.0',description:'Echo',config,actions:{run:defineAction({config,args:z.strictObject({}),input:z.string(),output:z.string(),mode:'value',description:'Echo',capabilities:[],effects:[],execute:({input})=>input})}});\n`;

  try {
    await writeFile(join(source, 'index.ts'), code);
    expect(await listInstalled(home)).toEqual([]);
    const installed = await addExtension(source, home);

    expect((await listInstalled(home))[0].manifest.type).toBe('@test/echo');
    expect((await loadInstalled('@test/echo', home)).actions.run.execute({ input: 'ok', args: {}, config: {} })).toBe(
      'ok',
    );
    await writeFile(join(source, 'index.ts'), code + '\nconst invalid: string = 42;');
    await expect(loadInstalled('@test/echo', home)).rejects.toMatchObject({ code: 3 });
    await expect(addExtension(source, home)).rejects.toMatchObject({ code: 2 });
    expect((await listInstalled(home))[0].artifactHash).toBe(installed.artifactHash);
    await writeFile(join(source, 'index.ts'), code);
    await loadInstalled('@test/echo', home);
    const registry = join(home, hash('@test/echo') + '.json');

    for (const capabilities of [
      ['unknown'],
      { whenAny: ['missing'], ifTrue: ['text'], ifFalse: [] },
      { whenAny: [], ifTrue: ['text'], ifFalse: [] },
    ]) {
      await writeFile(
        registry,
        JSON.stringify({
          ...installed,
          manifest: { ...installed.manifest, actions: { run: { ...installed.manifest.actions.run, capabilities } } },
        }),
      );
      await expect(listInstalled(home)).rejects.toMatchObject({ code: 3 });
    }
    await writeFile(registry, JSON.stringify(installed));
    await removeInstalled('@test/echo', home);
    expect(await readFile(join(source, 'index.ts'), 'utf8')).toBe(code);
    expect(await listInstalled(home)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
