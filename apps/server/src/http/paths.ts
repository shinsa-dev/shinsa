import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { DomainError } from '@shinsa/core';

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

function resolveExistingAncestor(path: string): string {
  return existsSync(path) ? path : resolveExistingAncestor(dirname(path));
}

export function resolveWritableInside(root: string, relative: string): string | null {
  const target = resolveInside(root, relative);
  if (!target) return null;
  const base = realpathSync(root);
  return isInside(base, realpathSync(resolveExistingAncestor(dirname(target)))) ? target : null;
}

const MAX_PATH_LENGTH = 4096;

export function assertRepoPath(value: string | null, options: { root?: boolean } = {}) {
  const path = (value ?? '').replace(/\/+$/, '');
  if (path === '' && options.root) return '';
  const segments = path.split('/');
  const invalid =
    path === '' ||
    path.length > MAX_PATH_LENGTH ||
    path.includes('\0') ||
    path.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (invalid) throw new DomainError('path_invalid', 'Name a file inside the repository by its path.');
  return path;
}
