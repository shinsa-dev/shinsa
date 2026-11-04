import type { Run } from '@shinsa/core';
import { Context, type Effect } from 'effect';
import type { Delivery } from '../delegations/schema.ts';
import type { ActiveRun } from './schema.ts';

export class LiveRuns extends Context.Service<
  LiveRuns,
  {
    readonly active: ReadonlyMap<string, ActiveRun>;
    readonly execute: (
      runId: string,
      prompt: string | null,
      delivery: Delivery | null
    ) => Effect.Effect<void>;
    readonly listServerNames: (run: Run) => Effect.Effect<string[]>;
  }
>()('shinsa/engine/agents/active/LiveRuns') {}
