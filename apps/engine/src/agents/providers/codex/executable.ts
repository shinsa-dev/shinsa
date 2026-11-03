import { Effect } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import { type LocateDeps, locateProgram, readProgramVersion } from '../versions.ts';
import {
  CODEX_EXECUTABLE_ENV,
  CODEX_MINIMUM_VERSION,
  type CodexExecutable,
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
  return readProgramVersion(path, parseCodexVersion);
}

export function locateCodex(deps: LocateDeps = {}) {
  return locateProgram('codex', CODEX_EXECUTABLE_ENV, deps);
}

export function resolveCodexExecutable(deps: CodexExecutableDeps = {}): Promise<CodexExecutable> {
  const readVersion = deps.readVersion ?? readCodexVersion;
  return edgeRuntime.runPromise(
    resolveExecutable({
      path: locateCodex(deps).path,
      readVersion: (path) => Effect.promise(() => readVersion(path)),
      minimumVersion: deps.minimumVersion ?? CODEX_MINIMUM_VERSION,
    })
  );
}
