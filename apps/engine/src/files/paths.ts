import { sep } from 'node:path';
import { DomainError } from '@shinsa/core';
import { PATH_LIMIT } from './schema.ts';

export function isInside(root: string, path: string) {
  const base = root.replace(/\/+$/, '');
  return path === root || path === base || path.startsWith(`${base}${sep}`);
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
