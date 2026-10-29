import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveBrowserEnv } from '../../../extensions/definitions.ts';
import { type ClaudeExecutable, type ExecutableResolver, resolveClaudeExecutable } from './executable.ts';

export type QueryFn = typeof query;

export interface ClaudeRuntime {
  runQuery: QueryFn;
  resolveExecutable: ExecutableResolver;
}

export const CLAUDE_RUNTIME: ClaudeRuntime = {
  runQuery: query,
  resolveExecutable: () => resolveClaudeExecutable(),
};

export class ClaudeSetupError extends Error {
  override name = 'ClaudeSetupError';
}

function resolveClaudeEnv(): Record<string, string | undefined> {
  const {
    CLAUDECODE: _claudeCode,
    ANTHROPIC_BASE_URL: _baseUrl,
    CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: _blockingLimit,
    EUNOE_DIR: _eunoeDir,
    ...env
  } = Bun.env;
  return resolveBrowserEnv(env);
}

export async function resolveClaudeProcess(resolveExecutable: ExecutableResolver) {
  const executable: ClaudeExecutable = await resolveExecutable();
  if (!executable.ok) throw new ClaudeSetupError(executable.message);
  return {
    version: executable.version,
    options: { pathToClaudeCodeExecutable: executable.path, env: resolveClaudeEnv() },
  };
}
