import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DomainError, describeList, resolveDisplayPath } from '@shinsa/core';

const MAX_ROOTS = 50;

export function expandHome(path: string, userHome: string) {
  if (path === '~') return userHome;
  if (path.startsWith('~/')) return join(userHome, path.slice(2));
  return path;
}

function isDirectory(path: string) {
  return existsSync(path) && statSync(path).isDirectory();
}

function isPrivacyRefusal(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'EPERM' || code === 'EACCES';
}

export const PRIVACY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

export class PrivateFoldersError extends DomainError {
  readonly folders: string[];
  readonly picked: string[];

  constructor(folders: string[], picked: string[], userHome: string) {
    const names = folders.map((folder) => resolveDisplayPath(folder, userHome));
    super(
      'roots_private',
      `macOS keeps ${describeList(names, 'and')} private. Turn on Shinsa in System Settings → Privacy & Security → Full Disk Access, then check again.`
    );
    this.folders = folders;
    this.picked = picked;
  }
}

function isReadable(root: string, read: (path: string) => unknown) {
  try {
    read(root);
    return true;
  } catch (error) {
    if (!isPrivacyRefusal(error)) throw error;
    return false;
  }
}

export function resolveChosenRoots(
  value: unknown,
  userHome: string,
  read: (path: string) => unknown = readdirSync
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainError('roots_invalid', 'Choose at least one folder that holds your repositories.');
  }
  if (value.length > MAX_ROOTS) {
    throw new DomainError('roots_invalid', `Choose at most ${MAX_ROOTS} folders.`);
  }
  const roots: string[] = [];
  const refused: string[] = [];
  const picked: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new DomainError('roots_invalid', 'Each folder must be a path.');
    }
    const path = expandHome(entry.trim(), userHome);
    if (!isAbsolute(path)) throw new DomainError('roots_invalid', `${entry} is not a full path.`);
    const root = resolve(path);
    if (!isDirectory(root))
      throw new DomainError('roots_invalid', `${entry} is not a folder on this machine.`);
    if (picked.includes(root)) continue;
    picked.push(root);
    if (isReadable(root, read)) roots.push(root);
    else refused.push(root);
  }
  if (refused.length > 0) throw new PrivateFoldersError(refused, picked, userHome);
  return roots;
}
