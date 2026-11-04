import { Effect } from 'effect';
import { type LocateDeps, locateProgram } from '../versions.ts';
import { ProgramVersions } from '../versions/service.ts';
import {
  CODEX_EXECUTABLE_ENV,
  CODEX_MINIMUM_VERSION,
  type CodexExecutableDeps,
} from './executable/schema.ts';
import { resolveExecutable } from './executable/service.ts';

export {
  CODEX_MINIMUM_VERSION,
  type CodexExecutable,
  type CodexExecutableDeps,
} from './executable/schema.ts';

export function parseCodexVersion(output: string) {
  return /codex-cli\s+(\d+\.\d+\.\d+)/i.exec(output)?.[1] ?? /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function readCodexVersion(path: string) {
  return ProgramVersions.use((versions) => versions.read(path, parseCodexVersion));
}

export function locateCodex(deps: LocateDeps = {}) {
  return locateProgram('codex', CODEX_EXECUTABLE_ENV, deps);
}

export const resolveCodexExecutable = Effect.fn('CodexExecutable.resolveInstalled')(function* (
  deps: CodexExecutableDeps = {}
) {
  const versions = yield* ProgramVersions;
  return yield* resolveExecutable({
    path: locateCodex(deps).path,
    readVersion: deps.readVersion ?? ((path) => versions.read(path, parseCodexVersion)),
    minimumVersion: deps.minimumVersion ?? CODEX_MINIMUM_VERSION,
  });
});
