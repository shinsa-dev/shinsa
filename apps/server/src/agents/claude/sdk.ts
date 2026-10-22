import type { query } from '@anthropic-ai/claude-agent-sdk';

export type QueryFn = typeof query;

export function resolveClaudeProcess() {
  const claudePath = Bun.which('claude', { PATH: Bun.env.PATH });
  const { CLAUDECODE: _claudeCode, ...env } = Bun.env;
  return { ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}), env };
}
