import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

function isInside(root: string, path: string) {
  return path === root || path.startsWith(`${root}${sep}`);
}

export function resolveInside(root: string, relative: string): string | null {
  if (!existsSync(root)) return null;
  const base = realpathSync(root);
  const target = resolve(base, relative);
  if (!isInside(base, target) || target === base) return null;
  if (!existsSync(target)) return target;
  return isInside(base, realpathSync(target)) ? target : null;
}
