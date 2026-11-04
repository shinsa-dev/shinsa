import { Effect, Layer } from 'effect';
import { BaseCheckouts } from '../../checks/base/service.ts';
import { FeedbackDrafter } from '../../feedback/draft/service.ts';
import { FeedbackEffects } from '../../feedback/effects/service.ts';
import { listFeedbackEnvironment, resolveFeedbackMachine } from '../../feedback/environment.ts';
import { FeedbackIssues } from '../../feedback/issues/service.ts';
import { PullRequestDescriber } from '../../github/description/service.ts';
import { BUNDLE } from '../../instance/bundle.ts';
import { createServerInstance } from '../../instance/install.ts';
import { CheckRuns } from './checks/service.ts';
import { Cleanup } from './cleanup/service.ts';
import { EditCommits } from './edits/service.ts';
import { Merging } from './merging/service.ts';
import { PullRequestSync } from './pull-requests/service.ts';
import { EffectReports } from './reports/service.ts';
import { EffectHandlers } from './runner/service.ts';
import type { EffectRunnerOptions } from './schema.ts';
import { EffectRunner } from './service.ts';
import { TaskSetup } from './setup/service.ts';
import { Shipping } from './shipping/service.ts';
import { EffectWorld } from './world/service.ts';

export function EffectRunnerLayer(options: EffectRunnerOptions) {
  const feedback = FeedbackEffects.layer({
    environment: (state, entry) =>
      listFeedbackEnvironment(
        state,
        entry,
        options.instance ?? createServerInstance(),
        resolveFeedbackMachine(Boolean(BUNDLE))
      ),
  }).pipe(
    Layer.provide(
      Layer.merge(
        FeedbackIssues.layer,
        Layer.succeed(
          FeedbackDrafter,
          options.draftFeedback ?? FeedbackDrafter.of({ draft: () => Effect.succeed(null) })
        )
      )
    )
  );
  const world = EffectWorld.layer(options).pipe(Layer.provide(feedback));
  const shared = Layer.mergeAll(PullRequestSync.layer, EditCommits.layer).pipe(Layer.provideMerge(world));
  const areas = Layer.mergeAll(
    TaskSetup.layer,
    CheckRuns.layer,
    Shipping.layer,
    Merging.layer,
    Cleanup.layer,
    EffectReports.layer
  ).pipe(Layer.provideMerge(shared));
  return EffectRunner.layer.pipe(
    Layer.provide(EffectHandlers.layer),
    Layer.provide(areas),
    Layer.provide(Layer.merge(BaseCheckouts.layer, PullRequestDescriber.layer))
  );
}
