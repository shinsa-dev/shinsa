import { sep } from 'node:path';
import { DomainError } from '@shinsa/core';
import { Result } from 'effect';
import { PATH_LIMIT } from './schema.ts';

export function isInside(root: string, path: string) {
  const base = root.replace(/\/+$/, '');
  return path === root || path === base || path.startsWith(`${base}${sep}`);
}

export function parseRepoPath(
  value: string | null,
  options: { root?: boolean } = {}
): Result.Result<string, DomainError> {
  const path = (value ?? '').replace(/\/+$/, '');
  if (path === '' && options.root) return Result.succeed('');
  const segments = path.split('/');
  const invalid =
    path === '' ||
    path.length > PATH_LIMIT ||
    path.includes('\0') ||
    path.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (invalid)
    return Result.fail(
      new DomainError({ code: 'path_invalid', message: 'Name a file inside the repository.' })
    );
  return Result.succeed(path);
}
