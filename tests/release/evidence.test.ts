import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluationProvenance } from '../../scripts/release/harness.ts';

test('evaluation provenance pins the current build and every evaluation implementation', async () => {
  const provenance = await evaluationProvenance();

  expect(provenance.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(typeof provenance.worktreeDirty).toBe('boolean');
  expect(provenance.build).toEqual(JSON.parse(await readFile('dist/build.json', 'utf8')));
  for (const [name, digest] of Object.entries(provenance.evaluatorHashes))
    expect(digest).toBe(
      createHash('sha256')
        .update(await readFile(`scripts/release/${name}`))
        .digest('hex'),
    );
});
