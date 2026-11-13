import type { Repo, ShinsaCommand, ShinsaEvent, ShinsaState, Task } from '@shinsa/core';
import { Context, Duration, Effect, Layer } from 'effect';
import { RunSupervisor } from '../../../agents/supervisor/service.ts';
import type { AutopilotJudge } from '../../../autopilot/judge.ts';
import { BriefingWriter } from '../../../briefing/service.ts';
import type { ServerConfig } from '../../../config/index.ts';
import { EngineConfig } from '../../../config/service.ts';
import { FeedbackEffects } from '../../../feedback/effects/service.ts';
import { LeadWakes } from '../../../initiatives/service.ts';
import type { HandoffEffects } from '../../../remote/handoffs/schema.ts';
import type { PreviewEffects } from '../../../remote/previews/schema.ts';
import type { ShareDescriber } from '../../../remote/share-describe/service.ts';
import type { ShareEffects } from '../../../remote/shares/schema.ts';
import { CurrentLogin } from '../../../repos/current-login/service.ts';
import type { LoginLookup, RootSource } from '../../../repos/index.ts';
import type { ProcessTracker } from '../../../resources/index.ts';
import type { WatchWriter } from '../../../schedules/suggest.ts';
import type { Slack } from '../../../slack/index.ts';
import { Evidence } from '../../../store/evidence/service.ts';
import type { RepositoryFinder, TriageResolver } from '../../../triage/index.ts';
import { NO_WORKTREE } from '../../../workspaces/schema.ts';
import { Workspaces } from '../../../workspaces/service.ts';
import type { DispatchOptions } from '../../engine/schema.ts';
import { EngineCore } from '../../engine/service.ts';
import { createEffectFailed, resolveEffectFailure } from '../../failures/classify.ts';
import type { EffectFailed, EffectFailure } from '../../failures/schema.ts';
import { type EffectRunnerOptions, TASK_GONE, type TaskServices, WATCH_INTERVAL } from '../schema.ts';

export class EffectWorld extends Context.Service<
  EffectWorld,
  {
    readonly config: ServerConfig;
    readonly runs: RunSupervisor['Service'];
    readonly briefings: BriefingWriter['Service'];
    readonly leads: LeadWakes['Service'];
    readonly triage: TriageResolver;
    readonly wordWatch: WatchWriter;
    readonly describeShare: ShareDescriber['Service']['describe'];
    readonly judgeAutopilot: AutopilotJudge;
    readonly timeZone: string;
    readonly findRepository: RepositoryFinder;
    readonly resolveLogin: LoginLookup;
    readonly roots: RootSource;
    readonly watchInterval: Duration.Duration;
    readonly workspaces: Workspaces['Service'];
    readonly services: TaskServices | null;
    readonly shares: ShareEffects;
    readonly previews: PreviewEffects;
    readonly handoffs: HandoffEffects;
    readonly slack: Slack['Service'] | null;
    readonly trackProcess: ProcessTracker | null;
    readonly feedback: FeedbackEffects['Service'];
    readonly evidence: Evidence['Service'];
    readonly state: Effect.Effect<ShinsaState>;
    dispatch(command: ShinsaCommand, options?: DispatchOptions): Effect.Effect<ShinsaEvent[], EffectFailure>;
    findTask(taskId: string): Effect.Effect<{ task: Task; repo: Repo }, EffectFailed>;
    findCheckout(taskId: string): Effect.Effect<{ task: Task; repo: Repo }, EffectFailed>;
  }
>()('shinsa/engine/runtime/effects/world/EffectWorld') {
  static layer(options: EffectRunnerOptions) {
    return Layer.effect(
      EffectWorld,
      Effect.gen(function* () {
        const engine = yield* EngineCore;
        const config = yield* EngineConfig;
        const runs = yield* RunSupervisor;
        const briefings = yield* BriefingWriter;
        const leads = yield* LeadWakes;
        const evidence = yield* Evidence;
        const feedback = yield* FeedbackEffects;
        const findTask = Effect.fn('EffectWorld.findTask')(function* (taskId: string) {
          const state = yield* engine.state;
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
          config,
          runs,
          briefings,
          leads,
          triage: options.triage,
          wordWatch: options.wordWatch ?? (() => Effect.succeed({ name: null, text: null })),
          describeShare: options.describeShare ?? (() => Effect.succeed(null)),
          judgeAutopilot: options.judgeAutopilot ?? (() => Effect.succeed(null)),
          timeZone: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          findRepository: options.findRepository ?? (() => Effect.succeed(null)),
          resolveLogin: options.resolveLogin
            ? Effect.promise(options.resolveLogin)
            : (yield* CurrentLogin).lookup,
          roots: options.roots ?? { listRoots: Effect.succeed(config.roots) },
          watchInterval:
            options.watchIntervalMs === undefined ? WATCH_INTERVAL : Duration.millis(options.watchIntervalMs),
          workspaces: options.workspaces ?? (yield* Workspaces),
          services: options.services ?? null,
          shares: options.shares,
          previews: options.previews,
          handoffs: options.handoffs,
          slack: options.slack ?? null,
          trackProcess: options.trackProcess ?? null,
          feedback,
          evidence,
          state: engine.state,
          dispatch: (command, dispatchOptions) =>
            engine.dispatch(command, dispatchOptions).pipe(Effect.mapError(resolveEffectFailure)),
          findTask,
          findCheckout,
        });
      })
    );
  }
}
