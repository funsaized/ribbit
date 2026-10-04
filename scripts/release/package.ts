import { cp, mkdir, readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const staging = await mkdtemp(join(tmpdir(), 'ribbit-package-'));
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const target = build.target;
const executable = build.executable;

if (
  createHash('sha256')
    .update(await readFile(`dist/${executable}`))
    .digest('hex') !== build.binarySha256
)
  throw new Error('Binary differs from build manifest; rebuild before packaging');
if (!/^[a-z0-9-]+$/.test(target)) throw new Error('Invalid build target');
const name = `ribbit-${pkg.version}-${target}`;
const root = join(staging, name);

try {
  await mkdir(root);
  for (const [source, destination] of [
    [`dist/${executable}`, executable],
    ['dist/lib', 'lib'],
    ['README.md', 'README.md'],
    ['Ribbit-PRD.md', 'Ribbit-PRD.md'],
    ['docs', 'docs'],
    ['mkdocs.yml', 'mkdocs.yml'],
    ['site-overrides', 'site-overrides'],
    ['requirements-docs.txt', 'requirements-docs.txt'],
    ...[
      'src',
      'npm',
      'scripts',
      'tests',
      'evals',
      'package.json',
      'bunfig.toml',
      'bun.lock',
      'tsconfig.json',
      '.oxlintrc.json',
      '.oxfmtrc.json',
    ].map((path) => [path, path]),
    ['examples', 'examples'],
    ['fixtures', 'fixtures'],
    ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
    ['CHANGELOG.md', 'CHANGELOG.md'],
    ['CONTRIBUTING.md', 'CONTRIBUTING.md'],
    ['SECURITY.md', 'SECURITY.md'],
    ['.github', '.github'],
  ]) {
    await mkdir(join(root, destination, '..'), { recursive: true });
    await cp(source, join(root, destination), {
      recursive: true,
      filter: (path) => basename(path) !== '__pycache__',
    });
  }
  const licensed = (await readdir('.')).includes('LICENSE');

  if (licensed) await cp('LICENSE', join(root, 'LICENSE'));
  await writeFile(
    join(root, 'BUILD.json'),
    JSON.stringify(
      {
        ...build,
        schemaVersion: 1,
        version: pkg.version,
        target,
        bun: Bun.version,
        revision: (
          await new Response(Bun.spawn(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe' }).stdout).text()
        ).trim(),
      },
      null,
      2,
    ) + '\n',
  );
  await mkdir('dist/releases', { recursive: true });
  const output = `dist/releases/${name}.tar.gz`;
  const archive = Bun.spawn(['tar', '-czf', output, '-C', staging, name], { stdout: 'inherit', stderr: 'inherit' });

  if ((await archive.exited) !== 0) throw new Error('Archive failed');
  const digest = createHash('sha256')
    .update(await readFile(output))
    .digest('hex');

  await writeFile(`${output}.sha256`, `${digest}  ${name}.tar.gz\n`);
  console.log(`${output}\n${digest}\nRelease artifact prepared; this command does not upload.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
