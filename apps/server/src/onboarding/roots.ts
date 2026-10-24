import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DomainError } from '@shinsa/core';

const MAX_ROOTS = 50;

export function expandHome(path: string, userHome: string) {
  if (path === '~') return userHome;
  if (path.startsWith('~/')) return join(userHome, path.slice(2));
  return path;
}

function isDirectory(path: string) {
  return existsSync(path) && statSync(path).isDirectory();
}

export function resolveChosenRoots(value: unknown, userHome: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainError('roots_invalid', 'Choose at least one folder that holds your repositories.');
  }
  if (value.length > MAX_ROOTS) {
    throw new DomainError('roots_invalid', `Choose at most ${MAX_ROOTS} folders.`);
  }
  const roots: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new DomainError('roots_invalid', 'Each folder must be a path.');
    }
    const path = expandHome(entry.trim(), userHome);
    if (!isAbsolute(path)) throw new DomainError('roots_invalid', `${entry} is not a full path.`);
    const root = resolve(path);
    if (!isDirectory(root))
      throw new DomainError('roots_invalid', `${entry} is not a folder on this machine.`);
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
}
