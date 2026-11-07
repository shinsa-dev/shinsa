import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { constFalse } from 'effect/Function';
import type { Prerequisite, PrerequisiteId } from '../schema.ts';
import { BUN_FILES, COMMANDS, INSTALL_ORDER, LABELS, SCRIPTS } from './schema.ts';

export function resolveInstallCommand(id: string) {
  return Object.hasOwn(COMMANDS, id) ? COMMANDS[id as PrerequisiteId] : null;
}

export function resolveInstallScript(id: string) {
  return Object.hasOwn(COMMANDS, id)
    ? (SCRIPTS[id as PrerequisiteId] ?? COMMANDS[id as PrerequisiteId])
    : null;
}

export function listMissingInstalls(checks: readonly Prerequisite[]) {
  const missing = new Set(checks.filter((check) => !(check.ok || check.optional)).map((check) => check.id));
  if (missing.has('brew')) missing.delete('git');
  return INSTALL_ORDER.filter((id) => missing.has(id));
}

export function resolvePrerequisiteLabel(id: string) {
  return Object.hasOwn(LABELS, id) ? LABELS[id as PrerequisiteId] : null;
}

export const isBunUsed = Effect.fn('Prerequisites.isBunUsed')(function* (roots: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const isFolder = (path: string) =>
    fs.stat(path).pipe(
      Effect.map((info) => info.type === 'Directory'),
      Effect.orElseSucceed(constFalse)
    );
  const listFolders = Effect.fn('Prerequisites.listFolders')(function* (root: string) {
    const names = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed((): string[] => []));
    const folders = names.filter((name) => !name.startsWith('.')).map((name) => join(root, name));
    return yield* Effect.filter(folders, isFolder);
  });
  for (const root of roots) {
    for (const folder of [root, ...(yield* listFolders(root))]) {
      for (const file of BUN_FILES) {
        if (yield* fs.exists(join(folder, file)).pipe(Effect.orElseSucceed(constFalse))) return true;
      }
    }
  }
  return false;
});
