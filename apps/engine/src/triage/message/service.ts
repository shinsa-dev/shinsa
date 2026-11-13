import { type MessageKind, ROUND_LIMITS, type ShinsaState, type PresetShape, type Task } from '@shinsa/core';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { describeDecisionQuestion, parseDecisionAnswer } from '../../agents/quick/decide.ts';
import { QuickCalls } from '../../agents/quick/service.ts';
import type { LocalRepo } from '../../repos/index.ts';
import { resolveQuickAsk } from '../classify.ts';
import { parseAnswerText } from '../decisions.ts';
import {
  describeProject,
  describeRepoCandidates,
  listOfferedRepos,
  parseRepoAnswer,
  resolveCandidatePool,
  resolveRepoProperty,
} from '../repositories.ts';
import type { ClassifierFailed, MessageClass } from '../schema.ts';
import { describeRoundWork, describeTask, resolveKindQuestion, resolveMessageSchema } from './prompt.ts';
import {
  MESSAGE_SHAPE_QUESTION,
  MESSAGE_SYSTEM,
  type MessageAnswer,
  REPOSITORY_SYSTEM,
  ROUND_SHAPE_QUESTION,
  ROUND_SHAPE_SCHEMA,
  ROUND_SHAPE_SYSTEM,
} from './schema.ts';

export class TriageClassifier extends Context.Service<
  TriageClassifier,
  {
    readonly message: (task: Task, text: string) => Effect.Effect<MessageClass | null, ClassifierFailed>;
    readonly shape: (task: Task, request: string) => Effect.Effect<PresetShape | null, ClassifierFailed>;
    readonly repository: (
      state: ShinsaState,
      task: Task,
      local: LocalRepo[]
    ) => Effect.Effect<string | null, ClassifierFailed>;
  }
>()('shinsa/engine/triage/message/TriageClassifier') {
  static readonly layer = Layer.effect(
    TriageClassifier,
    Effect.gen(function* () {
      const ask = resolveQuickAsk((yield* QuickCalls).classify);
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);

      const message = Effect.fn('TriageClassifier.message')(function* (task: Task, text: string) {
        const kindQuestion = resolveKindQuestion(task);
        const prompt = [
          ...describeTask(task),
          '',
          'Message:',
          text,
          '',
          'Decisions:',
          describeDecisionQuestion('kind', kindQuestion),
          describeDecisionQuestion('shape', MESSAGE_SHAPE_QUESTION),
        ].join('\n');
        const answer = yield* ask<MessageAnswer>(MESSAGE_SYSTEM, prompt, resolveMessageSchema(kindQuestion));
        const kind = answer ? (parseDecisionAnswer(kindQuestion, answer.kind) as MessageKind | null) : null;
        if (!answer || !kind) return null;
        return {
          kind,
          title: parseAnswerText(answer.title, ROUND_LIMITS.title),
          why: parseAnswerText(answer.why, ROUND_LIMITS.why),
          shape: parseDecisionAnswer(MESSAGE_SHAPE_QUESTION, answer.shape) as PresetShape | null,
        };
      });

      const shape = Effect.fn('TriageClassifier.shape')(function* (task: Task, request: string) {
        const prompt = [
          ...describeTask(task),
          '',
          'Request for the next round:',
          request,
          '',
          'Decision:',
          describeDecisionQuestion('shape', ROUND_SHAPE_QUESTION),
        ].join('\n');
        const answer = yield* ask<{ shape?: unknown }>(ROUND_SHAPE_SYSTEM, prompt, ROUND_SHAPE_SCHEMA);
        return parseDecisionAnswer(ROUND_SHAPE_QUESTION, answer?.shape) as PresetShape | null;
      });

      const repository = Effect.fn('TriageClassifier.repository')(function* (
        state: ShinsaState,
        task: Task,
        local: LocalRepo[]
      ) {
        const work = describeRoundWork(task);
        const pool = yield* withFiles(resolveCandidatePool(state, task, local, work.join('\n')));
        const offered = listOfferedRepos(pool);
        if (offered.length === 0) return null;
        const prompt = [
          ...describeTask(task),
          '',
          ...describeProject(pool),
          ...describeRepoCandidates(offered),
          '',
          ...work,
        ].join('\n');
        const answer = yield* ask<{ repo?: unknown }>(REPOSITORY_SYSTEM, prompt, {
          type: 'object',
          properties: { repo: resolveRepoProperty(offered, true) },
          required: ['repo'],
          additionalProperties: false,
        });
        return parseRepoAnswer(offered, answer?.repo, true) ?? null;
      });

      return TriageClassifier.of({ message, shape, repository });
    })
  );
}
