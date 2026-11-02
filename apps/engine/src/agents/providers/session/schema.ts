import type { Effect } from 'effect';
import type { AgentSession, AgentSessionResult } from '../types.ts';

export interface ScopedAgentSession {
  readonly session: AgentSession;
  readonly done: Effect.Effect<AgentSessionResult>;
}
