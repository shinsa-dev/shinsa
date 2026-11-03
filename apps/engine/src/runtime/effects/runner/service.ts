import type { ShinsaEffect } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { Slack } from '../../../slack/index.ts';
import type { EffectAttempt, EffectContext } from '../../engine/schema.ts';
import { createEffectFailed } from '../../failures/classify.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { CheckRuns } from '../checks/service.ts';
import { Cleanup } from '../cleanup/service.ts';
import { Merging } from '../merging/service.ts';
import { PullRequestSync } from '../pull-requests/service.ts';
import { type EffectOf, SLACK_DISCONNECTED } from '../schema.ts';
import { TaskSetup } from '../setup/service.ts';
import { Shipping } from '../shipping/service.ts';
import { EffectWorld } from '../world/service.ts';

export class EffectHandlers extends Context.Service<
  EffectHandlers,
  { apply(effect: ShinsaEffect, attempt: EffectAttempt): Effect.Effect<void, EffectFailure> }
>()('shinsa/engine/runtime/effects/runner/EffectHandlers') {
  static readonly layer = Layer.effect(
    EffectHandlers,
    Effect.gen(function* () {
      const world = yield* EffectWorld;
      const setup = yield* TaskSetup;
      const checks = yield* CheckRuns;
      const shipping = yield* Shipping;
      const merging = yield* Merging;
      const cleanup = yield* Cleanup;
      const pullRequests = yield* PullRequestSync;

      const withContext = <A>(
        attempt: EffectAttempt,
        work: (context: EffectContext) => PromiseLike<A>
      ): Effect.Effect<A, EffectFailure> => world.bridge((signal) => work({ ...attempt, signal }));

      const withSlack = Effect.fn('EffectHandlers.withSlack')(function* (
        work: (slack: Slack) => Effect.Effect<void, EffectFailure>
      ) {
        if (!world.slack) return yield* createEffectFailed(SLACK_DISCONNECTED);
        yield* work(world.slack);
      });

      const suggestWatch = Effect.fn('EffectHandlers.suggestWatch')(function* (
        effect: EffectOf<'watch.suggest'>,
        attempt: EffectAttempt
      ) {
        const wording = yield* world.bridge(() => world.wordWatch(effect.server, effect.data));
        yield* world.dispatch(
          {
            type: 'watch_suggestion.record',
            projectId: effect.projectId,
            server: effect.server,
            name: wording.name,
            text: wording.text,
            timeZone: world.timeZone,
          },
          { id: `${attempt.key}:watch_suggestion.record` }
        );
      });

      const describeShare = Effect.fn('EffectHandlers.describeShare')(function* (
        taskId: string,
        attempt: EffectAttempt
      ) {
        const task = (yield* world.state).tasks[taskId];
        if (!task?.share) return;
        const description = yield* world.bridge(() => world.describeShare(task));
        if (!description) return;
        yield* world.dispatch(
          { type: 'share.describe', taskId, description },
          { id: `${attempt.key}:share.describe` }
        );
      });

      const apply = Effect.fn('EffectHandlers.apply')(function* (
        effect: ShinsaEffect,
        attempt: EffectAttempt
      ) {
        const runs = world.runs;
        switch (effect.kind) {
          case 'task.triage':
            return yield* setup.triage(effect.taskId, attempt);
          case 'worktree.create':
            return yield* setup.createWorktree(effect.taskId, attempt);
          case 'config.verify':
            return yield* setup.verify(effect.taskId, attempt);
          case 'run.execute':
            return yield* world.bridge(() => runs.execute(effect.runId));
          case 'run.cancel':
            return yield* world.bridge(() => runs.cancel(effect.runId));
          case 'run.steer':
            return yield* world.bridge(() => runs.steer(effect.runId, effect.text, attempt.key, effect.from));
          case 'question.resolve':
            return yield* world.bridge(() => runs.resolveQuestion(effect.gateId));
          case 'checks.run':
            return yield* checks.run(effect, attempt);
          case 'pull_request.open':
            return yield* shipping.open(effect.taskId, attempt);
          case 'pull_request.push':
            return yield* shipping.push(effect.taskId, attempt);
          case 'pull_request.merge':
            return yield* merging.merge(effect);
          case 'pull_request.watch':
            yield* pullRequests.sync(effect.taskId, true);
            return;
          case 'pull_request.close':
            return yield* merging.close(effect, attempt);
          case 'worktree.remove':
            return yield* cleanup.removeWorktree(effect.taskId, attempt);
          case 'scratch.remove':
            return yield* cleanup.removeScratch(effect.taskId);
          case 'briefing.request':
            return yield* Effect.sync(() => world.briefings.schedule());
          case 'watch.suggest':
            return yield* suggestWatch(effect, attempt);
          case 'run.wake':
            return yield* world.bridge(() => runs.wake(effect.runId, effect.generation));
          case 'delegation.steer':
            return yield* world.bridge(() => runs.deliver(effect.runId, effect.generation));
          case 'delegation.reply':
            return yield* world.bridge(() => runs.replyToDelegate(effect.runId, effect.questionId));
          case 'share.link':
            return yield* withContext(attempt, (context) => world.shares.link(effect.taskId, context));
          case 'share.describe':
            return yield* describeShare(effect.taskId, attempt);
          case 'preview.link':
            return yield* withContext(attempt, (context) =>
              world.previews.link(effect.taskId, effect.serviceId, context)
            );
          case 'handoff.link':
            return yield* withContext(attempt, (context) => world.handoffs.link(effect.taskId, context));
          case 'handoff.revoke':
            return yield* world.bridge(() => world.handoffs.revoke(effect.taskId, effect.guestId));
          case 'slack.evaluate':
            return yield* withSlack((slack) =>
              withContext(attempt, (context) => slack.evaluate(effect, context))
            );
          case 'slack.status':
            return yield* withSlack((slack) =>
              withContext(attempt, (context) => slack.status(effect, context))
            );
          case 'slack.post':
            return yield* withSlack((slack) => world.bridge(() => slack.post(effect)));
          case 'feedback.draft':
            return yield* withContext(attempt, (context) => world.feedback.draft(effect.feedbackId, context));
          case 'feedback.file':
            return yield* withContext(attempt, (context) => world.feedback.file(effect.feedbackId, context));
        }
      });

      return EffectHandlers.of({ apply });
    })
  );
}
