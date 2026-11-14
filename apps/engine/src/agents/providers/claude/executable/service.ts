import { Effect } from 'effect';
import { compareVersions } from '../../versions.ts';
import {
  CLAUDE_EXECUTABLE_ENV,
  CLAUDE_INSTALL_URL,
  type ClaudeExecutable,
  type ClaudeExecutableDefinition,
} from './schema.ts';

export const resolveClaudeProgram = Effect.fn('ClaudeExecutable.resolve')(function* (
  definition: ClaudeExecutableDefinition
) {
  const { path, override } = definition.location;
  if (override) return { ok: true, path: override, version: null } satisfies ClaudeExecutable;
  if (!path) {
    return {
      ok: false,
      reason: 'not_installed',
      message: `Claude Code is not installed. Install it from ${CLAUDE_INSTALL_URL}, or set ${CLAUDE_EXECUTABLE_ENV} to the program to run.`,
    } satisfies ClaudeExecutable;
  }
  const version = yield* definition.readVersion(path);
  const minimum = yield* definition.minimumVersion;
  if (version && compareVersions(version, minimum) < 0) {
    return {
      ok: false,
      reason: 'outdated',
      message: `Claude Code ${version} is older than Shinsa needs (${minimum} or newer). Update it from Settings → General, or run \`claude update\`.`,
    } satisfies ClaudeExecutable;
  }
  return { ok: true, path, version } satisfies ClaudeExecutable;
});
