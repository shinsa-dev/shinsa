import { Duration, type Effect } from 'effect';
import type { AgentSessionInput, AgentSessionResult } from '../../types.ts';
import type { CodexTurnError } from '../classify.ts';
import type { CodexExecutable, CodexExecutableResolver } from '../executable/schema.ts';

export interface CodexRuntime {
  readonly resolveExecutable: CodexExecutableResolver;
  readonly env?: Record<string, string | undefined>;
}

export type CodexSessionMode = 'turns' | 'compact';

export interface QueuedPrompt {
  readonly text: string;
  readonly wire: string;
  readonly steer: boolean;
}

export interface TurnEnd {
  readonly status: string;
  readonly error: CodexTurnError | null;
}

export interface ContextReading {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
  readonly totalProcessedTokens: number | null;
}

export interface BufferedEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

export interface CodexSessionDefinition {
  readonly input: AgentSessionInput;
  readonly mode: CodexSessionMode;
  readonly executable: Effect.Effect<CodexExecutable>;
  readonly env: Record<string, string | undefined> | undefined;
  readonly now: Effect.Effect<number>;
  readonly requestTimeout: Duration.Duration;
  readonly compactGrace: Duration.Duration;
  readonly heartbeat: Duration.Duration;
  readonly token: Effect.Effect<string>;
}

export interface CodexSessionHandle {
  readonly done: Effect.Effect<AgentSessionResult>;
  readonly steer: (text: string, from: 'you' | 'shinsa') => Effect.Effect<boolean>;
  readonly cancel: Effect.Effect<void>;
}

export const FAST_TIER = 'fast';

export const SUMMARY_LIMIT = 2000;

export const REQUEST_TIMEOUT = Duration.seconds(5);

export const COMPACT_GRACE = Duration.seconds(5);

export const TOOL_TIMEOUT_SEC = 24 * 60 * 60;

export const BUFFER_LIMIT = 500;

export const NEVER_COMPACT_TOKENS = Number.MAX_SAFE_INTEGER;

export const STREAM_ENDED = 'The agent’s process ended before it finished its turn.';
