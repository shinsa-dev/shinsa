import type { Repo, ShinsaCommand, ShinsaEvent, ShinsaState, Task } from '@shinsa/core';
import { Context, Duration, Effect, Fiber, Layer } from 'effect';
import type { RunSupervisor } from '../../../agents/supervisor.ts';
import type { Briefings } from '../../../briefing/index.ts';
import { BaseCheckouts } from '../../../checks/base.ts';
import type { ServerConfig } from '../../../config/index.ts';
import { listFeedbackEnvironment, resolveFeedbackMachine } from '../../../feedback/environment.ts';
import { FeedbackEffects } from '../../../feedback/index.ts';
import { RepoCiCache } from '../../../github/ci.ts';
import { PullRequestDescriptions } from '../../../github/description.ts';
import { BUNDLE } from '../../../instance/bundle.ts';
import { createServerInstance } from '../../../instance/install.ts';
import type { HandoffEffects } from '../../../remote/handoffs.ts';
import type { PreviewEffects } from '../../../remote/previews.ts';
import type { ShareDescriber } from '../../../remote/share-describe.ts';
import type { ShareEffects } from '../../../remote/shares.ts';
import { createLoginResolver, type LoginResolver, type RootSource } from '../../../repos/index.ts';
import type { ProcessTracker } from '../../../resources/index.ts';
import type { WatchWriter } from '../../../schedules/suggest.ts';
import type { Slack } from '../../../slack/index.ts';
import { EvidenceStore } from '../../../store/evidence/index.ts';
import type { TriageResolver } from '../../../triage/index.ts';
import type { RepositoryFinder } from '../../../triage/message.ts';
import { Workspaces } from '../../../workspaces/index.ts';
import { NO_WORKTREE } from '../../../workspaces/schema.ts';
import type { Engine } from '../../engine.ts';
import type { DispatchOptions } from '../../engine/schema.ts';
import { createEffectFailed, resolveEffectFailure } from '../../failures/classify.ts';
import type { EffectFailed, EffectFailure } from '../../failures/schema.ts';
import { type EffectRunnerOptions, TASK_GONE, type TaskServices, WATCH_INTERVAL } from '../schema.ts';

export class EffectWorld extends Context.Service<
  EffectWorld,
  {
    readonly engine: Engine;
    readonly config: ServerConfig;
    readonly runs: RunSupervisor;
    readonly briefings: Briefings;
    readonly triage: TriageResolver;
    readonly wordWatch: WatchWriter;
    readonly describeShare: ShareDescriber;
    readonly timeZone: string;
    readonly findRepository: RepositoryFinder;
    readonly resolveLogin: LoginResolver;
    readonly roots: RootSource;
    readonly watchInterval: Duration.Duration;
    readonly workspaces: Workspaces;
    readonly services: TaskServices | null;
    readonly shares: ShareEffects;
    readonly previews: PreviewEffects;
    readonly handoffs: HandoffEffects;
    readonly slack: Slack | null;
    readonly trackProcess: ProcessTracker | null;
    readonly feedback: FeedbackEffects;
    readonly evidence: EvidenceStore;
    readonly descriptions: PullRequestDescriptions;
    readonly bases: BaseCheckouts;
    readonly ci: RepoCiCache;
    readonly state: Effect.Effect<ShinsaState>;
    dispatch(command: ShinsaCommand, options?: DispatchOptions): Effect.Effect<ShinsaEvent[], EffectFailure>;
    bridge<A>(work: (signal: AbortSignal) => PromiseLike<A>): Effect.Effect<A, EffectFailure>;
    bridgeWith<A, E>(
      work: (signal: AbortSignal) => PromiseLike<A>,
      failure: (error: unknown) => E
    ): Effect.Effect<A, E>;
    findTask(taskId: string): Effect.Effect<{ task: Task; repo: Repo }, EffectFailed>;
    findCheckout(taskId: string): Effect.Effect<{ task: Task; repo: Repo }, EffectFailed>;
  }
>()('shinsa/engine/runtime/effects/world/EffectWorld') {
  static layer(
    engine: Engine,
    config: ServerConfig,
    runs: RunSupervisor,
    briefings: Briefings,
    options: EffectRunnerOptions
  ) {
    return Layer.sync(EffectWorld, () => {
      const evidence = new EvidenceStore(config.evidenceDir);
      const feedback = new FeedbackEffects(
        engine,
        config.dataDir,
        options.draftFeedback ?? (() => Promise.resolve(null)),
        (state, entry) =>
          listFeedbackEnvironment(
            state,
            entry,
            options.instance ?? createServerInstance(),
            resolveFeedbackMachine(Boolean(BUNDLE))
          )
      );

      const bridgeWith = Effect.fn('EffectWorld.bridge')(function* <A, E>(
        work: (signal: AbortSignal) => PromiseLike<A>,
        failure: (error: unknown) => E
      ) {
        const controller = new AbortController();
        const fiber = yield* Effect.forkChild(
          Effect.tryPromise({ try: () => work(controller.signal), catch: failure })
        );
        return yield* Fiber.join(fiber).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => controller.abort()).pipe(Effect.andThen(Fiber.await(fiber)))
          )
        );
      });

      const findTask = Effect.fn('EffectWorld.findTask')(function* (taskId: string) {
        const state = engine.state;
        const task = state.tasks[taskId];
        const repo = task?.repoId ? state.repos[task.repoId] : undefined;
        if (!task || !repo) return yield* createEffectFailed(TASK_GONE);
        return { task, repo };
      });

      const findCheckout = Effect.fn('EffectWorld.findCheckout')(function* (taskId: string) {
        const found = yield* findTask(taskId);
        if (!found.task.worktreePath || !found.task.branch) return yield* createEffectFailed(NO_WORKTREE);
        return found;
      });

      return EffectWorld.of({
        engine,
        config,
        runs,
        briefings,
        triage: options.triage,
        wordWatch: options.wordWatch ?? (() => Promise.resolve({ name: null, text: null })),
        describeShare: options.describeShare ?? (() => Promise.resolve(null)),
        timeZone: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        findRepository: options.findRepository ?? (() => Promise.resolve(null)),
        resolveLogin: options.resolveLogin ?? createLoginResolver(config.userHome),
        roots: options.roots ?? { listRoots: () => Promise.resolve(config.roots) },
        watchInterval:
          options.watchIntervalMs === undefined ? WATCH_INTERVAL : Duration.millis(options.watchIntervalMs),
        workspaces: options.workspaces ?? new Workspaces({ worktreesDir: config.worktreesDir }),
        services: options.services ?? null,
        shares: options.shares,
        previews: options.previews,
        handoffs: options.handoffs,
        slack: options.slack ?? null,
        trackProcess: options.trackProcess ?? null,
        feedback,
        evidence,
        descriptions: new PullRequestDescriptions(evidence),
        bases: new BaseCheckouts(config.checkBasesDir),
        ci: new RepoCiCache(),
        state: Effect.sync(() => engine.state),
        dispatch: (command, dispatchOptions) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, dispatchOptions),
            catch: resolveEffectFailure,
          }),
        bridge: (work) => bridgeWith(work, resolveEffectFailure),
        bridgeWith,
        findTask,
        findCheckout,
      });
    });
  }
}
