import { type Handoff, type Run, type RunHandoff, type ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import { type AgentProvider } from '../providers/index.ts';
import type { Transcripts } from '../transcripts/index.ts';

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
  transcripts: Transcripts;
  labelOf: (providerId: string) => string;
  recordLost: (sessionId: string) => Promise<void>;
}

export const FRESH: TurnPlan = { resume: null, fork: false, handoff: null, record: null };

export interface TurnFoldInput {
  run: Run;
  plan: TurnPlan;
  stepPrompt: boolean;
  firstAttempt: boolean;
  folds: boolean;
}

export class TurnPlanFailed extends Schema.TaggedError<TurnPlanFailed, { readonly brand: unique symbol }>()(
  'TurnPlanFailed',
  { message: Schema.String }
) {}
