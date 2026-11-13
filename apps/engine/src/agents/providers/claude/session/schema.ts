import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { RunFailure, RunUsage } from '@shinsa/core';
import { Duration, type Effect, Schema } from 'effect';
import type { DeferredServer } from '../../../../extensions/loader/schema.ts';
import type { AgentSessionResult } from '../../types.ts';
import type { TurnEvidence, TurnVerdict } from '../classify.ts';
import type { ClaudeProcessHandle } from '../process/schema.ts';
import type { EunoeLink } from '../route/schema.ts';
import type { ClaudeRuntime } from '../sdk/schema.ts';

export interface ClaudeSessionOptions {
  readonly runtime: ClaudeRuntime;
  readonly eunoe?: EunoeLink | null;
  readonly foldedTurnMs?: number;
  readonly contextTimeoutMs?: number;
  readonly exitGraceMs?: number;
  readonly interruptTimeoutMs?: number;
  readonly backgroundWaitMs?: number;
  readonly backgroundGraceMs?: number;
  readonly createProcess?: () => ClaudeProcessHandle;
  readonly now?: () => number;
}

export interface PendingPrompt {
  readonly id: string;
  readonly text: string;
  readonly steer: boolean;
}

export interface PromptLedger {
  readonly pending: readonly PendingPrompt[];
  readonly echoes: boolean;
}

export interface ClaudeSessionState {
  readonly ledger: PromptLedger;
  readonly cancelled: boolean;
  readonly closed: boolean;
  readonly terminated: boolean;
  readonly started: boolean;
  readonly eunoe: boolean;
  readonly stuck: RunFailure | null;
  readonly evidence: TurnEvidence;
  readonly verdict: TurnVerdict | null;
  readonly summary: string | null;
  readonly usage: RunUsage | null;
  readonly contextTokens: number | null;
  readonly contextWindow: number | null;
  readonly cacheExpiresAt: number | null;
  readonly background: ReadonlySet<string>;
  readonly waiting: BackgroundWait | null;
  readonly connected: Readonly<Record<string, McpServerConfig>>;
}

export interface BackgroundWait {
  readonly finished: readonly string[];
  readonly timedOut: boolean;
}

export interface ContextMeasure {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
}

export interface ClaudeSessionHandle {
  readonly done: Effect.Effect<AgentSessionResult>;
  readonly steer: (text: string, from: 'you' | 'shinsa') => Effect.Effect<boolean>;
  readonly cancel: Effect.Effect<void>;
  readonly hasPendingBackgroundWork: Effect.Effect<boolean>;
  readonly loadMcpServers: (
    servers: DeferredServer[],
    abandoned: AbortSignal
  ) => Effect.Effect<Record<string, string | null>, ClaudeSessionEnded | McpServersRefused>;
}

export class ClaudeStreamBroke extends Schema.TaggedError<
  ClaudeStreamBroke,
  { readonly brand: unique symbol }
>()('ClaudeStreamBroke', { message: Schema.String }) {}

export class ClaudeStartFailed extends Schema.TaggedError<
  ClaudeStartFailed,
  { readonly brand: unique symbol }
>()('ClaudeStartFailed', { message: Schema.String }) {}

export class ClaudeSessionEnded extends Schema.TaggedError<
  ClaudeSessionEnded,
  { readonly brand: unique symbol }
>()('ClaudeSessionEnded', { message: Schema.String }) {}

export class McpServersRefused extends Schema.TaggedError<
  McpServersRefused,
  { readonly brand: unique symbol }
>()('McpServersRefused', { message: Schema.String }) {}

export class ClaudeCallFailed extends Schema.TaggedError<
  ClaudeCallFailed,
  { readonly brand: unique symbol }
>()('ClaudeCallFailed', { message: Schema.String }) {}

export const FOLDED_TURN = Duration.seconds(60);

export const CONTEXT_TIMEOUT = Duration.seconds(5);

export const EXIT_GRACE = Duration.seconds(10);

export const INTERRUPT_TIMEOUT = Duration.seconds(5);

export const BACKGROUND_WAIT = Duration.minutes(30);

export const BACKGROUND_GRACE = Duration.seconds(10);

export const SUMMARY_LIMIT = 2000;

export const STREAM_ENDED = 'The agent’s process ended before it finished its turn.';

export const SESSION_ENDED = 'The session has ended.';

export const BACKGROUND_FINISHED = 'Your background work finished.';

export const BACKGROUND_TIMED_OUT =
  'Your background work was still running after 30 minutes, so Shinsa stopped it.';

export const BACKGROUND_CARRY_ON = 'Carry on with your step and finish with its hand-over tool.';

export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
