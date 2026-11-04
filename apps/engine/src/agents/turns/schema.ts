import { type Handoff, type Run, type RunHandoff, type ShinsaState } from '@shinsa/core';
import type { Effect } from 'effect';
import { type AgentProvider } from '../providers/index.ts';
import type { Transcripts } from '../transcripts/service.ts';

export interface TurnPlan {
  resume: string | null;
  fork: boolean;
  handoff: Handoff | null;
  record: RunHandoff | null;
}

export interface TurnContext {
  state: ShinsaState;
  run: Run;
  provider: AgentProvider;
  cwd: string;
  transcripts: Transcripts['Service'];
  labelOf: (providerId: string) => string;
  recordLost: (sessionId: string) => Effect.Effect<void>;
}

export const FRESH: TurnPlan = { resume: null, fork: false, handoff: null, record: null };

export interface TurnFoldInput {
  run: Run;
  plan: TurnPlan;
  stepPrompt: boolean;
  firstAttempt: boolean;
  folds: boolean;
}
