import { expect, test } from 'bun:test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sandbox } from '../../scripts/release/harness.ts';
import { builtins } from '../../src/catalog/index.ts';
import { hash } from '../../src/sdk/manifest/index.ts';

for (const mode of ['source', 'compiled'] as const)
  test(`${mode} uninstall accepts legacy registrations and missing sources without validating neighbors`, async () => {
    const env = await sandbox();
    const home = join(env.dir, 'data/ribbit/extensions');
    // Synthetic registrations: this artifact must never be imported during removal.
    const code = "throw new Error('Uninstall imported extension code');";
    const artifactHash = hash(code),
      artifact = artifactHash + '.mjs';
    const run = async (operation: string[]) => {
      const args = ['extensions', ...operation, '--json'];

      if (mode === 'compiled') return env.run(args);
      const child = Bun.spawn([process.execPath, resolve('src/cli/main.ts'), ...args], {
        cwd: env.dir,
        env: env.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [out, err, result] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { out, err, code: result };
    };
    const register = async (type: string, source: string, action: object) => {
      await writeFile(
        join(home, hash(type) + '.json'),
        JSON.stringify({
          schemaVersion: 1,
          source,
          artifactHash,
          artifact,
          manifest: { ...builtins.find, type, actions: { run: action } },
        }),
      );
    };
    const current = builtins.find.actions.run;
    const legacy = { ...current, capabilities: ['object'], inferenceWhen: ['about'] };

    try {
      await mkdir(home, { recursive: true });
      await writeFile(join(home, artifact), code);
      const source = join(env.dir, 'source');

      await mkdir(source);
      await writeFile(join(source, 'index.ts'), '// Synthetic source to preserve\n');
      await register('@test/legacy', source, legacy);
      const listing = await run(['list']);

      expect(listing.code).toBe(3);
      expect(listing.err).toContain('inferenceWhen');
      const removed = await run(['remove', '@test/legacy']);

      expect(removed.code, JSON.stringify(removed)).toBe(0);
      expect(JSON.parse(removed.out).removed).toBe('@test/legacy');
      expect(await readFile(join(source, 'index.ts'), 'utf8')).toBe('// Synthetic source to preserve\n');
      expect(await readdir(home)).toEqual([]);

      await writeFile(join(home, artifact), code);
      await register('@test/current', join(env.dir, 'missing-current-source'), current);
      await register('@test/legacy', join(env.dir, 'missing-legacy-source'), legacy);
      await register('@test/stale', join(env.dir, 'missing-stale-source'), { ...current, capabilities: ['obsolete'] });
      const neighbor = await readFile(join(home, hash('@test/stale') + '.json'), 'utf8');

      for (const type of ['@test/current', '@test/legacy']) {
        const result = await run(['remove', type]);

        expect(result.code, JSON.stringify(result)).toBe(0);
        expect(await readFile(join(home, artifact), 'utf8')).toBe(code);
        expect(await readFile(join(home, hash('@test/stale') + '.json'), 'utf8')).toBe(neighbor);
        expect(await readdir(home)).not.toContain(hash(type) + '.json');
      }
      const last = await run(['remove', '@test/stale']);

      expect(last.code, JSON.stringify(last)).toBe(0);
      expect(await readdir(home)).toEqual([]);
    } finally {
      await env.close();
    }
  });
