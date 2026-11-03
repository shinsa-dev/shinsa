import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { findManifestFile } from '../../../files/manifest.ts';
import { PACKAGE_MANIFEST } from '../../../files/schema.ts';
import { BUNDLE, type ShinsaBundle } from '../../../instance/bundle.ts';
import { edgeRuntime } from '../../../runtime/edge.ts';
import { SDK_PACKAGE } from '../../../versions/schema.ts';
import { type LocateDeps, locateProgram, readProgramVersion } from '../versions.ts';
import { CLAUDE_EXECUTABLE_ENV, type ClaudeExecutable, type ExecutableDeps } from './executable/schema.ts';
import { resolveClaudeProgram } from './executable/service.ts';
import { SdkManifestText } from './schema.ts';

export type { ClaudeExecutable, ExecutableDeps } from './executable/schema.ts';

export function resolveSdkPackage(packagePath?: string, bundle: ShinsaBundle | null = BUNDLE) {
  if (bundle && !packagePath) return bundle.sdk;
  const { version, claudeCodeVersion } = findManifestFile(
    packagePath ?? resolveSdkPackagePath(),
    SdkManifestText
  );
  return { version, claudeCodeVersion };
}

export function resolveSdkClaudeVersion(packagePath?: string) {
  return resolveSdkPackage(packagePath).claudeCodeVersion;
}

function resolveSdkPackagePath() {
  return join(dirname(fileURLToPath(import.meta.resolve(SDK_PACKAGE))), PACKAGE_MANIFEST);
}

export function parseClaudeVersion(output: string) {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function readClaudeVersion(path: string) {
  return readProgramVersion(path, parseClaudeVersion);
}

export function locateClaude(deps: LocateDeps = {}) {
  return locateProgram('claude', CLAUDE_EXECUTABLE_ENV, deps);
}

export function resolveClaudeExecutable(deps: ExecutableDeps = {}): Promise<ClaudeExecutable> {
  const readVersion = deps.readVersion ?? readClaudeVersion;
  return edgeRuntime.runPromise(
    resolveClaudeProgram({
      location: locateClaude(deps),
      readVersion: (path) => Effect.promise(() => readVersion(path)),
      minimumVersion: Effect.sync(() => deps.minimumVersion ?? resolveSdkClaudeVersion()),
    })
  );
}
