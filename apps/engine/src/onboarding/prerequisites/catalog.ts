import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Result } from 'effect';
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

function listFolders(root: string) {
  const entries = Result.try(() => readdirSync(root, { withFileTypes: true }));
  return Result.getOrElse(entries, () => [])
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => join(root, entry.name));
}

export function isBunUsed(roots: readonly string[]) {
  return roots
    .flatMap((root) => [root, ...listFolders(root)])
    .some((folder) => BUN_FILES.some((file) => existsSync(join(folder, file))));
}
