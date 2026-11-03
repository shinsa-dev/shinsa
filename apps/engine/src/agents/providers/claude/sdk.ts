import { query } from '@anthropic-ai/claude-agent-sdk';
import { edgeRuntime } from '../../../runtime/edge.ts';
import { resolveClaudeExecutable } from './executable.ts';
import type { ExecutableResolver } from './executable/schema.ts';
import type { ClaudeRuntime } from './sdk/schema.ts';
import { resolveClaudeLaunch } from './sdk/service.ts';

export { ClaudeSetupError, type ClaudeRuntime, type QueryFn } from './sdk/schema.ts';

export const CLAUDE_RUNTIME: ClaudeRuntime = {
  runQuery: query,
  resolveExecutable: () => resolveClaudeExecutable(),
};

export function resolveClaudeProcess(resolveExecutable: ExecutableResolver) {
  return edgeRuntime.runPromise(resolveClaudeLaunch(resolveExecutable));
}
