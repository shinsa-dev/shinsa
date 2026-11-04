import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { findManifestFile } from '../../../files/manifest.ts';
import { PACKAGE_MANIFEST } from '../../../files/schema.ts';
import { BUNDLE, type ShinsaBundle } from '../../../instance/bundle.ts';
import { SDK_PACKAGE } from '../../../versions/schema.ts';
import { type LocateDeps, locateProgram } from '../versions.ts';
import { ProgramVersions } from '../versions/service.ts';
import { CLAUDE_EXECUTABLE_ENV, type ExecutableDeps } from './executable/schema.ts';
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
  return ProgramVersions.use((versions) => versions.read(path, parseClaudeVersion));
}

export function locateClaude(deps: LocateDeps = {}) {
  return locateProgram('claude', CLAUDE_EXECUTABLE_ENV, deps);
}

export const resolveClaudeExecutable = Effect.fn('ClaudeExecutable.resolveInstalled')(function* (
  deps: ExecutableDeps = {}
) {
  const versions = yield* ProgramVersions;
  return yield* resolveClaudeProgram({
    location: locateClaude(deps),
    readVersion: deps.readVersion ?? ((path) => versions.read(path, parseClaudeVersion)),
    minimumVersion: Effect.sync(() => deps.minimumVersion ?? resolveSdkClaudeVersion()),
  });
});
