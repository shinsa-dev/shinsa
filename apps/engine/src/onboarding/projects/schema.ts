import type { ShinsaCommand, ShinsaState } from '@shinsa/core';
import type { Effect } from 'effect';
import type { LocalRepo } from '../../repos/schema.ts';
import type { OnboardingFailure } from '../schema.ts';

export interface ProjectSetup {
  readonly state: Effect.Effect<ShinsaState>;
  readonly login: Effect.Effect<string | null, OnboardingFailure>;
  readonly dispatch: (command: ShinsaCommand, id: string) => Effect.Effect<void, OnboardingFailure>;
  readonly upsertRepo: (
    projectId: string,
    path: string,
    id: string
  ) => Effect.Effect<void, OnboardingFailure>;
  readonly listLocal: (roots: readonly string[], limit: number) => Effect.Effect<LocalRepo[]>;
  readonly readOrigin: (repo: string) => Effect.Effect<string | null>;
}

export const MAX_SUGGESTED_REPOS = 400;
