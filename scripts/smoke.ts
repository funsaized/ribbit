import { binaryName, cleanEnvironment } from './platform.ts';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, chmod, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'ribbit-smoke-'));

try {
  const env = {
    ...cleanEnvironment(dir),
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_DATA_HOME: join(dir, 'data'),
  };
  const executable = join(dir, binaryName);

  await copyFile(join('dist', binaryName), executable);
  await chmod(executable, 0o755);
  await cp('dist/lib', join(dir, 'lib'), { recursive: true });
  for (const flag of ['--help', '--version']) {
    const p = Bun.spawn([executable, flag], { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' });

    assert.equal(await p.exited, 0);
    assert.equal(await new Response(p.stderr).text(), '');
    assert.match(await new Response(p.stdout).text(), /ribbit/i);
  }
  const source = join(dir, 'example');

  for (const args of [
    ['extensions', 'scaffold', source],
    ['extensions', 'check', source],
    ['extensions', 'test', source],
  ]) {
    const p = Bun.spawn([executable, ...args], { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' });
    const stderr = await new Response(p.stderr).text();

    assert.equal(await p.exited, 0, stderr);
  }
  // Reuse the source regression matrix against the isolated installation, without an SDK override.
  const diagnostics = Bun.spawn([process.execPath, 'test', resolve('tests/scaffold/diagnostics.test.ts')], {
    env: { ...env, RIBBIT_FIXTURE_TEST_BINARY: executable },
    stdout: 'inherit',
    stderr: 'inherit',
  });

  assert.equal(await diagnostics.exited, 0, 'Installed fixture diagnostics failed');
  console.log('Installed CLI help and extension authoring smoke passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
