import { Effect } from 'effect';
import { compareVersions } from '../../versions.ts';
import {
  CODEX_EXECUTABLE_ENV,
  CODEX_INSTALL,
  type CodexExecutable,
  type CodexExecutableDefinition,
} from './schema.ts';

export const resolveExecutable = Effect.fn('CodexExecutable.resolve')(function* (
  definition: CodexExecutableDefinition
) {
  const { path, minimumVersion } = definition;
  if (!path) {
    const missing: CodexExecutable = {
      ok: false,
      reason: 'not_installed',
      message: `Codex is not installed. ${CODEX_INSTALL}, or set ${CODEX_EXECUTABLE_ENV} to the program to run.`,
      version: null,
    };
    return missing;
  }
  const version = yield* definition.readVersion(path);
  if (version && compareVersions(version, minimumVersion) < 0) {
    const outdated: CodexExecutable = {
      ok: false,
      reason: 'outdated',
      message: `Codex ${version} is older than Shinsa needs (${minimumVersion} or newer). Update it from Settings → About, or run \`codex update\`.`,
      version,
    };
    return outdated;
  }
  const found: CodexExecutable = { ok: true, path, version };
  return found;
});
