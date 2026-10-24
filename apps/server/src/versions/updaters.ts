import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProgramId } from '@shinsa/core';
import { whichOnPath } from '../agents/providers/versions.ts';

export interface Updater {
  command: string[];
  label: string;
  env?: Record<string, string>;
}

export interface UpdaterDeps {
  which?: (command: string) => string | null;
  isExecutable?: (path: string) => boolean;
}

const CODEX_LATEST = '@openai/codex@latest';

function readRealPath(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isExecutableFile(path: string) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCodexUpdater(path: string, deps: UpdaterDeps): Updater {
  const which = deps.which ?? whichOnPath;
  const isExecutable = deps.isExecutable ?? isExecutableFile;
  const find = (tool: string) => {
    const beside = join(dirname(path), tool);
    return isExecutable(beside) ? beside : which(tool);
  };
  const real = readRealPath(path);
  const brew = /\/(Cellar|Caskroom)\//.test(real) ? find('brew') : null;
  if (brew) return { command: [brew, 'upgrade', 'codex'], label: 'brew upgrade codex' };
  const bun = real.includes('/.bun/') ? find('bun') : null;
  if (bun) return { command: [bun, 'add', '-g', CODEX_LATEST], label: `bun add -g ${CODEX_LATEST}` };
  const npm = real.includes('/node_modules/') ? find('npm') : null;
  if (npm) {
    return {
      command: [npm, 'install', '-g', CODEX_LATEST],
      label: `npm install -g ${CODEX_LATEST}`,
      env: { PATH: `${dirname(npm)}:${Bun.env.PATH ?? ''}` },
    };
  }
  return { command: [path, 'update'], label: 'codex update' };
}

export function resolveUpdater(program: ProgramId, path: string, deps: UpdaterDeps = {}): Updater {
  if (program === 'claude') return { command: [path, 'update'], label: 'claude update' };
  return resolveCodexUpdater(path, deps);
}
