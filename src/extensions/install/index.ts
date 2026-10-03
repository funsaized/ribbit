import { pathToFileURL } from 'node:url';
import { readdir, readFile, mkdir, rename, writeFile, rm, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { hash, stable, type Manifest } from '../../sdk/manifest/index.ts';
import { RibbitError } from '../../engine/records/index.ts';
import { validateCapabilities } from '../../sdk/capabilities.ts';

export interface Installation {
  schemaVersion: 1;
  source: string;
  artifactHash: string;
  artifact: string;
  manifest: Manifest;
}

export const extensionHome = () =>
  join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'ribbit', 'extensions');

export async function sourceDigest(source: string): Promise<string> {
  let count = 0,
    bytes = 0;
  const entries: [string, string][] = [];

  async function walk(dir: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (['node_modules', '.git', '.ribbit-build', 'dist'].includes(entry.name)) continue;
      const path = join(dir, entry.name);

      if (entry.isSymbolicLink()) throw new RibbitError(5, 'Extension source symlinks are unsupported');
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|mts|js|mjs|json)$/.test(entry.name)) {
        const buffer = await readFile(path);

        bytes += buffer.length;
        count++;
        if (count > 1000 || bytes > 16 * 1024 * 1024) throw new RibbitError(6, 'Extension source budget exceeded');
        entries.push([relative(source, path).split(sep).join('/'), hash(buffer)]);
      }
    }
  }

  await walk(source);

  return hash(stable(entries));
}

export async function listInstalled(home = extensionHome()): Promise<Installation[]> {
  try {
    const files = (await readdir(home)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));

    return await Promise.all(
      files.toSorted().map(async (name) => {
        const item = JSON.parse(await readFile(join(home, name), 'utf8')) as Installation;

        if (
          item.schemaVersion !== 1 ||
          item.manifest?.schemaVersion !== 1 ||
          typeof item.source !== 'string' ||
          !/^[a-f0-9]{64}\.mjs$/.test(item.artifact) ||
          !/^[a-f0-9]{64}$/.test(item.artifactHash)
        )
          throw new RibbitError(3, 'Invalid installed extension registry');

        for (const action of Object.values(item.manifest.actions)) {
          if (Object.hasOwn(action, 'inferenceWhen'))
            throw new RibbitError(3, 'Replace inferenceWhen with conditional capabilities and run extensions add');
          validateCapabilities(action.capabilities, action.args, 3);
        }

        return item;
      }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    if (error instanceof RibbitError) throw error;
    throw new RibbitError(3, 'Cannot read extension registry');
  }
}

export async function activate(
  source: string,
  code: Uint8Array,
  manifest: Manifest,
  home = extensionHome(),
): Promise<Installation> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const artifactHash = hash(code),
    artifact = `${artifactHash}.mjs`;
  const item: Installation = { schemaVersion: 1, source: await realpath(source), artifactHash, artifact, manifest };
  const target = join(home, `${hash(manifest.type)}.json`),
    temp = `${target}.${crypto.randomUUID()}.tmp`;
  const artifactTemp = join(home, artifact + '.' + crypto.randomUUID() + '.tmp');

  try {
    await writeFile(artifactTemp, code, { mode: 0o600, flag: 'wx' });
    await rename(artifactTemp, join(home, artifact));
  } finally {
    await rm(artifactTemp, { force: true });
  }
  try {
    await writeFile(temp, stable(item) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }

  return item;
}

export async function removeInstalled(type: string, home = extensionHome()): Promise<void> {
  const items = await listInstalled(home),
    item = items.find((i) => i.manifest.type === type);

  if (!item) throw new RibbitError(3, 'Extension is not installed');
  await rm(join(home, `${hash(type)}.json`));
  if (!items.some((i) => i.manifest.type !== type && i.artifact === item.artifact))
    await rm(join(home, item.artifact), { force: true });
}

export async function loadInstalled(type: string, home = extensionHome()): Promise<any> {
  const item = (await listInstalled(home)).find((i) => i.manifest.type === type);

  if (!item) throw new RibbitError(3, 'Extension is not installed; use extensions add');
  if ((await sourceDigest(item.source)) !== item.manifest.sourceHash)
    throw new RibbitError(3, 'Extension source changed; explicitly rebuild with extensions add');
  const path = join(home, item.artifact);

  if (hash(await readFile(path)) !== item.artifactHash)
    throw new RibbitError(3, 'Installed extension artifact changed');
  try {
    return (await import(pathToFileURL(path).href)).default;
  } catch {
    throw new RibbitError(5, 'Installed extension import failed (details redacted)');
  }
}
