import { isAbsolute, join, resolve } from 'node:path';
import { DomainError, describeList, resolveDisplayPath } from '@shinsa/core';
import { Effect, FileSystem } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { isFolder } from '../files/probe.ts';
import { describeError } from '../log/redact.ts';
import { OnboardingCallFailed } from './schema.ts';

const MAX_ROOTS = 50;

export function expandHome(path: string, userHome: string) {
  if (path === '~') return userHome;
  if (path.startsWith('~/')) return join(userHome, path.slice(2));
  return path;
}

export const PRIVACY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

export interface PrivateFolders extends DomainError {
  readonly folders: string[];
  readonly picked: string[];
}

const PRIVATE_CODE = 'roots_private';

function createPrivateFolders(folders: string[], picked: string[], userHome: string): PrivateFolders {
  const names = folders.map((folder) => resolveDisplayPath(folder, userHome));
  const error = new DomainError({
    code: PRIVATE_CODE,
    message: `macOS keeps ${describeList(names, 'and')} private. Turn on Shinsa in System Settings → Privacy & Security → Full Disk Access, then check again.`,
  });
  return Object.assign(error, { folders, picked });
}

export function isPrivateFolders(error: DomainError): error is PrivateFolders {
  return error.code === PRIVATE_CODE && 'folders' in error && 'picked' in error;
}

const isReadable = Effect.fn('Onboarding.isReadable')(function* (
  root: string,
  read: (path: string) => Effect.Effect<unknown, PlatformError, FileSystem.FileSystem>
) {
  return yield* read(root).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      error.reason._tag === 'PermissionDenied'
        ? Effect.succeed(false)
        : Effect.fail(new OnboardingCallFailed({ message: describeError(error) }))
    )
  );
});

const readFolder = Effect.fn('Onboarding.readFolder')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readDirectory(path);
});

export const resolveChosenRoots = Effect.fn('Onboarding.resolveChosenRoots')(function* (
  value: unknown,
  userHome: string,
  read: (path: string) => Effect.Effect<unknown, PlatformError, FileSystem.FileSystem> = readFolder
) {
  if (!Array.isArray(value) || value.length === 0) {
    return yield* new DomainError({
      code: 'roots_invalid',
      message: 'Choose a folder with your repositories.',
    });
  }
  if (value.length > MAX_ROOTS) {
    return yield* new DomainError({ code: 'roots_invalid', message: `Choose at most ${MAX_ROOTS} folders.` });
  }
  const roots: string[] = [];
  const refused: string[] = [];
  const picked: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return yield* new DomainError({ code: 'roots_invalid', message: 'Each folder must be a path.' });
    }
    const path = expandHome(entry.trim(), userHome);
    if (!isAbsolute(path)) {
      return yield* new DomainError({ code: 'roots_invalid', message: `${entry} is not a full path.` });
    }
    const root = resolve(path);
    if (!(yield* isFolder(root))) {
      return yield* new DomainError({
        code: 'roots_invalid',
        message: 'That is not a folder on this machine.',
      });
    }
    if (picked.includes(root)) continue;
    picked.push(root);
    if (yield* isReadable(root, read)) roots.push(root);
    else refused.push(root);
  }
  if (refused.length > 0) return yield* createPrivateFolders(refused, picked, userHome);
  return roots;
});
