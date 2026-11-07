import type { ShinsaState, Task } from '@shinsa/core';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { QuickCalls } from '../../agents/quick/service.ts';
import type { LocalRepo } from '../../repos/index.ts';
import { resolveQuickAsk } from '../classify.ts';
import type { ClassifierFailed, TriageResult } from '../schema.ts';
import { describeTriagePrompt, parseTriageAnswer, resolveTriagePlan, resolveTriageSchema } from './plan.ts';
import { TRIAGE_SYSTEM, type TriageAnswer, TriageTeam } from './schema.ts';

export class TaskTriage extends Context.Service<
  TaskTriage,
  {
    readonly resolve: (
      state: ShinsaState,
      task: Task,
      local: LocalRepo[]
    ) => Effect.Effect<TriageResult, ClassifierFailed>;
  }
>()('shinsa/engine/triage/task/TaskTriage') {
  static readonly layer = Layer.effect(
    TaskTriage,
    Effect.gen(function* () {
      const ask = resolveQuickAsk((yield* QuickCalls).classify);
      const team = yield* TriageTeam;
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);

      const resolve = Effect.fn('TaskTriage.resolve')(function* (
        state: ShinsaState,
        task: Task,
        local: LocalRepo[]
      ) {
        const plan = yield* withFiles(resolveTriagePlan(state, task, local, team ? yield* team : null));
        const answer = yield* ask<TriageAnswer>(
          TRIAGE_SYSTEM,
          describeTriagePrompt(state, plan),
          resolveTriageSchema(plan)
        );
        if (!answer) return plan.fallback;
        return parseTriageAnswer(state, plan, answer);
      });

      return TaskTriage.of({ resolve });
    })
  );
}
