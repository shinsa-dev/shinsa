import { dirname, join } from 'node:path';
import type { ProgramId } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { whichOnPath } from '../agents/providers/versions.ts';
import { isExecutable, selectRealPath } from '../files/probe.ts';
import { CODEX_LATEST, type Updater, type UpdaterDeps } from './schema.ts';

export type { Updater, UpdaterDeps } from './schema.ts';

const resolveCodexUpdater = Effect.fn('Versions.resolveCodexUpdater')(function* (
  path: string,
  deps: UpdaterDeps
) {
  const find = Effect.fn('Versions.findUpdaterTool')(function* (tool: string) {
    const beside = join(dirname(path), tool);
    if (yield* isExecutable(beside)) return beside;
    return deps.which ? deps.which(tool) : yield* whichOnPath(tool);
  });
  const real = Option.getOrElse(yield* selectRealPath(path), () => path);
  const brew = /\/(Cellar|Caskroom)\//.test(real) ? yield* find('brew') : null;
  if (brew) return { command: [brew, 'upgrade', 'codex'], label: 'brew upgrade codex' } satisfies Updater;
  const bun = real.includes('/.bun/') ? yield* find('bun') : null;
  if (bun) {
    return {
      command: [bun, 'add', '-g', CODEX_LATEST],
      label: `bun add -g ${CODEX_LATEST}`,
    } satisfies Updater;
  }
  const npm = real.includes('/node_modules/') ? yield* find('npm') : null;
  if (npm) {
    return {
      command: [npm, 'install', '-g', CODEX_LATEST],
      label: `npm install -g ${CODEX_LATEST}`,
      env: { PATH: `${dirname(npm)}:${Bun.env.PATH ?? ''}` },
    } satisfies Updater;
  }
  return { command: [path, 'update'], label: 'codex update' } satisfies Updater;
});

export const resolveUpdater = Effect.fn('Versions.resolveUpdater')(function* (
  program: ProgramId,
  path: string,
  deps: UpdaterDeps = {}
) {
  if (program === 'claude') return { command: [path, 'update'], label: 'claude update' } satisfies Updater;
  return yield* resolveCodexUpdater(path, deps);
});
