import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runCommand } from '../../shell/index.ts';

const VERSION_TIMEOUT_MS = 15_000;

const versions = new Map<string, { mtimeMs: number; version: string | null }>();

function splitVersion(version: string) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left: string, right: string) {
  const a = splitVersion(left);
  const b = splitVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function readModifiedAt(path: string) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

export async function readProgramVersion(path: string, parse: (output: string) => string | null) {
  const mtimeMs = readModifiedAt(path);
  const cached = versions.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.version;
  const result = await runCommand([path, '--version'], tmpdir(), { timeoutMs: VERSION_TIMEOUT_MS });
  const version = parse(`${result.stdout}\n${result.stderr}`);
  versions.set(path, { mtimeMs, version });
  return version;
}
