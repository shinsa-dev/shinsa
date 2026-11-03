import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { DomainError } from '@shinsa/core';
import { PATH_LIMIT } from './schema.ts';

export function isFolder(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isInside(root: string, path: string) {
  const base = root.replace(/\/+$/, '');
  return path === root || path === base || path.startsWith(`${base}${sep}`);
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

export function assertRepoPath(value: string | null, options: { root?: boolean } = {}) {
  const path = (value ?? '').replace(/\/+$/, '');
  if (path === '' && options.root) return '';
  const segments = path.split('/');
  const invalid =
    path === '' ||
    path.length > PATH_LIMIT ||
    path.includes('\0') ||
    path.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (invalid) throw new DomainError({ code: 'path_invalid', message: 'Name a file inside the repository.' });
  return path;
}
