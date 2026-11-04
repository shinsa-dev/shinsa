import { Context, Duration, type Effect } from 'effect';
import type { AgentSession } from '../providers/index.ts';

export const IDLE_RELEASE_MS = 30 * 60 * 1000;

export const MAX_IDLE_PIN_MS = 4 * 60 * 60 * 1000;

export const IDLE_RELEASE = Duration.millis(IDLE_RELEASE_MS);

export interface IdleReleaseTimings {
  readonly idle: Duration.Duration;
  readonly maxPinMs: number;
}

export const IdleReleaseSettings = Context.Reference<IdleReleaseTimings>(
  'shinsa/engine/agents/idle/IdleReleaseSettings',
  { defaultValue: () => ({ idle: IDLE_RELEASE, maxPinMs: MAX_IDLE_PIN_MS }) }
);

export interface IdleReleaseOptions {
  idleMs?: number;
  maxPinMs?: number;
  now?: () => number;
}

export interface IdleEntry {
  readonly session: AgentSession;
  readonly waits: number;
  readonly pinnedSince: number | null;
}

export interface IdleReleaseDefinition {
  readonly release: (runId: string, session: AgentSession) => Effect.Effect<void>;
  readonly idle: Duration.Duration;
  readonly maxPinMs: number;
  readonly now: Effect.Effect<number>;
}

export interface IdleReleaseHandle {
  readonly wait: (runId: string, session: AgentSession) => Effect.Effect<Effect.Effect<void>>;
  readonly isWaiting: (runId: string, session: AgentSession) => Effect.Effect<boolean>;
  readonly touch: (runId: string) => Effect.Effect<void>;
  readonly forget: (runId: string) => Effect.Effect<void>;
}
