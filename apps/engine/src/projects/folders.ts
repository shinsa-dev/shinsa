import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DomainError } from '@shinsa/core';
import { expandHome } from '../onboarding/roots.ts';

export function resolveProjectFolder(raw: string, userHome: string) {
  const text = raw.trim();
  const path = expandHome(text, userHome);
  if (!text || !isAbsolute(path)) {
    throw new DomainError('folder_invalid', 'Give a full path, or one with ~/.');
  }
  const folder = resolve(path);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new DomainError('folder_invalid', 'That is not a folder on this machine.');
  }
  return realpathSync(folder);
}
