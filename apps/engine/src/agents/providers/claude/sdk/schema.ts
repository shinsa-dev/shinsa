import type { query } from '@anthropic-ai/claude-agent-sdk';
import { Schema } from 'effect';
import type { ExecutableResolver } from '../executable/schema.ts';

export type QueryFn = typeof query;

export interface ClaudeRuntime {
  readonly runQuery: QueryFn;
  readonly resolveExecutable: ExecutableResolver;
}

export class ClaudeSetupError extends Schema.TaggedError<
  ClaudeSetupError,
  { readonly brand: unique symbol }
>()('ClaudeSetupError', { message: Schema.String }) {}

export interface ClaudeLaunch {
  version: string | null;
  options: { pathToClaudeCodeExecutable: string; env: Record<string, string | undefined> };
}

export const ROUTE_ENV = [
  'CLAUDECODE',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE',
  'EUNOE_DIR',
];
