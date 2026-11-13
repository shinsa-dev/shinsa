import type { ShinsaEffect } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { provideTaskGitHub } from '../../../github/identity/resolve.ts';
import { MachineGitHub } from '../../../github/identity/schema.ts';
import type { Slack, SlackRefusal, SlackRelayFailure } from '../../../slack/index.ts';
import type { EffectAttempt } from '../../engine/schema.ts';
import { createEffectFailed, resolveEffectFailure } from '../../failures/classify.ts';
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
      const machine = yield* MachineGitHub;

      const withSlack = Effect.fn('EffectHandlers.withSlack')(function* (
        work: (slack: Slack['Service']) => Effect.Effect<void, SlackRefusal | SlackRelayFailure>
      ) {
        if (!world.slack) return yield* createEffectFailed(SLACK_DISCONNECTED);
        yield* work(world.slack).pipe(Effect.mapError(resolveEffectFailure));
      });

      const suggestWatch = Effect.fn('EffectHandlers.suggestWatch')(function* (
        effect: EffectOf<'watch.suggest'>,
        attempt: EffectAttempt
      ) {
        const wording = yield* world.wordWatch(effect.server, effect.data);
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
        const description = yield* world.describeShare(task);
        if (!description) return;
        yield* world.dispatch(
          { type: 'share.describe', taskId, description },
          { id: `${attempt.key}:share.describe` }
        );
      });

      const applyEffect = Effect.fn('EffectHandlers.applyEffect')(function* (
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
            return yield* runs.execute(effect.runId, null, null).pipe(Effect.mapError(resolveEffectFailure));
          case 'run.cancel':
            return yield* runs.cancel(effect.runId);
          case 'run.steer':
            return yield* runs
              .steer(effect.runId, effect.text, attempt.key, effect.from)
              .pipe(Effect.mapError(resolveEffectFailure));
          case 'question.resolve':
            return yield* runs.resolveQuestion(effect.gateId).pipe(Effect.mapError(resolveEffectFailure));
          case 'checks.run':
            return yield* checks.run(effect, attempt);
          case 'pull_request.open':
            return yield* shipping.open(effect.taskId, attempt);
          case 'pull_request.push':
            return yield* shipping.push(effect.taskId, attempt);
          case 'pull_request.merge':
            return yield* merging.merge(effect, attempt);
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
            return yield* world.briefings.schedule;
          case 'initiative.wake':
            return yield* world.leads.schedule(effect.initiativeId);
          case 'watch.suggest':
            return yield* suggestWatch(effect, attempt);
          case 'run.wake':
            return yield* runs
              .wake(effect.runId, effect.generation)
              .pipe(Effect.mapError(resolveEffectFailure));
          case 'delegation.steer':
            return yield* runs
              .deliver(effect.runId, effect.generation)
              .pipe(Effect.mapError(resolveEffectFailure));
          case 'delegation.reply':
            return yield* runs.replyToDelegate(effect.runId, effect.questionId);
          case 'share.link':
            return yield* world.shares
              .link(effect.taskId, attempt)
              .pipe(Effect.mapError(resolveEffectFailure));
          case 'share.describe':
            return yield* describeShare(effect.taskId, attempt);
          case 'preview.link':
            return yield* world.previews
              .link(effect.taskId, effect.serviceId, attempt)
              .pipe(Effect.mapError(resolveEffectFailure));
          case 'handoff.link':
            return yield* world.handoffs.link(effect.taskId, attempt);
          case 'handoff.revoke':
            return yield* world.handoffs
              .revoke(effect.taskId, effect.guestId)
              .pipe(Effect.mapError(resolveEffectFailure));
          case 'slack.evaluate':
            return yield* withSlack((slack) => slack.evaluate(effect, attempt.key));
          case 'slack.status':
            return yield* withSlack((slack) => slack.status(effect, attempt.key));
          case 'slack.post':
            return yield* withSlack((slack) => slack.post(effect));
          case 'slack.merge':
            return yield* withSlack((slack) => slack.merge(effect, attempt.key));
          case 'slack.react':
            return yield* withSlack((slack) => slack.react(effect));
          case 'feedback.draft':
            return yield* Effect.mapError(
              world.feedback.draft(effect.feedbackId, attempt.key),
              resolveEffectFailure
            );
          case 'feedback.file':
            return yield* Effect.mapError(
              world.feedback.file(effect.feedbackId, attempt.key),
              resolveEffectFailure
            );
        }
      });

      const apply = (effect: ShinsaEffect, attempt: EffectAttempt) =>
        'taskId' in effect
          ? provideTaskGitHub(machine, world.state, effect.taskId)(applyEffect(effect, attempt))
          : applyEffect(effect, attempt);

      return EffectHandlers.of({ apply });
    })
  );
}
