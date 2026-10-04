import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export const MIN_FZF_VERSION = '0.74.3';

export function pickerVersion(output: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(output.trim());
  const parts = match?.slice(1, 4).map(Number);

  if (!parts || !parts.every(Number.isSafeInteger)) return { status: 'invalid' as const };
  const [major, minor, patch] = parts;
  const supported = major > 0 || minor > 74 || (minor === 74 && patch >= 3);

  return { status: supported ? ('supported' as const) : ('unsupported' as const), version: parts.join('.') };
}

export async function checkPicker() {
  const executable = Bun.which('fzf');

  if (!executable) return { status: 'missing' as const, minimum: MIN_FZF_VERSION };
  try {
    const { stdout } = await execute(executable, ['--version'], {
      timeout: 3000,
      maxBuffer: 4096,
      killSignal: 'SIGKILL',
    });

    return { ...pickerVersion(stdout), minimum: MIN_FZF_VERSION };
  } catch {
    return { status: 'failed' as const, minimum: MIN_FZF_VERSION };
  }
}
