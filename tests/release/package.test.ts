import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

test('native archives exclude Python caches without dropping source or evidence', async () => {
  // Keep the synthetic package input under the checkout so Git provenance resolves normally.
  await mkdir('dist', { recursive: true });
  const dir = await mkdtemp(join(resolve('dist'), 'ribbit-package-test-'));
  const binary = 'Synthetic packaging fixture, not an executable.\n';
  const build = {
    target: 'linux-x64',
    executable: 'ribbit',
    binarySha256: createHash('sha256').update(binary).digest('hex'),
  };
  const files: Record<string, string> = {
    ...Object.fromEntries(
      [
        'README.md',
        'Ribbit-PRD.md',
        'mkdocs.yml',
        'requirements-docs.txt',
        'bunfig.toml',
        'bun.lock',
        '.oxlintrc.json',
        '.oxfmtrc.json',
        'THIRD_PARTY_NOTICES.md',
        'CHANGELOG.md',
        'CONTRIBUTING.md',
        'SECURITY.md',
        'LICENSE',
      ].map((path) => [path, `# Synthetic package fixture: ${path}\n`]),
    ),
    'tsconfig.json': '{}',
    'package.json': JSON.stringify({ version: '0.0.0-synthetic' }),
    'dist/build.json': JSON.stringify(build),
    'dist/ribbit': binary,
    'dist/lib/sdk.ts': '// Synthetic SDK fixture\n',
    'docs/index.md': '# Synthetic documentation\n',
    'site-overrides/fixture.html': '<!-- Synthetic site fixture -->\n',
    'src/fixture.ts': '// Synthetic source fixture\n',
    'npm/fixture.cjs': '// Synthetic installer fixture\n',
    'scripts/docs-hooks.py': '# Synthetic source fixture\n',
    'scripts/__pycache__/fixture.pyc': 'Synthetic bytecode\n',
    'src/nested/__pycache__/fixture.pyc': 'Synthetic nested bytecode\n',
    'scripts/__pycache__-notes.txt': 'Synthetic source file with a similar name\n',
    'tests/fixture.test.ts': '// Synthetic test fixture\n',
    'evals/results/synthetic.json': JSON.stringify({ synthetic: true, pass: false }),
    'examples/fixture.txt': 'Synthetic example\n',
    'fixtures/evals/synthetic.json': JSON.stringify({ synthetic: true }),
    '.github/workflows/fixture.yml': '# Synthetic workflow fixture\n',
  };

  async function run(args: string[]) {
    const child = Bun.spawn(args, { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(code, err).toBe(0);

    return out;
  }

  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
    await run([process.execPath, resolve('scripts/release/package.ts')]);
    const name = 'ribbit-0.0.0-synthetic-linux-x64';
    const archive = join(dir, 'dist/releases', `${name}.tar.gz`);
    const listing = await run(['tar', '-tzf', archive]);

    expect(listing).not.toMatch(/(^|\/)__pycache__(\/|$)/m);
    expect((await readFile(`${archive}.sha256`, 'utf8')).split(' ')[0]).toBe(
      createHash('sha256')
        .update(await readFile(archive))
        .digest('hex'),
    );
    await mkdir(join(dir, 'unpacked'));
    await run(['tar', '-xzf', archive, '-C', join(dir, 'unpacked')]);
    const root = join(dir, 'unpacked', name);

    for (const [path, content] of Object.entries(files)) {
      if (path.includes('/__pycache__/') || path === 'dist/build.json') continue;
      expect(await readFile(join(root, path.replace(/^dist\//, '')), 'utf8')).toBe(content);
    }
    const metadata = JSON.parse(await readFile(join(root, 'BUILD.json'), 'utf8'));

    expect(metadata).toMatchObject({ ...build, schemaVersion: 1, version: '0.0.0-synthetic' });
    expect(metadata.revision).toMatch(/^[a-f0-9]{40}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
