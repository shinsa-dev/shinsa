import type { ShinsaEffect } from '@shinsa/core';
import { Duration, Effect, Layer, ManagedRuntime } from 'effect';
import type { RunSupervisor } from '../../src/agents/supervisor/service.ts';
import { RunSupervisor as RunSupervisorTag } from '../../src/agents/supervisor/service.ts';
import type { BriefingWriter } from '../../src/briefing/service.ts';
import { BriefingWriter as BriefingWriterTag } from '../../src/briefing/service.ts';
import { ChecksLayer } from '../../src/checks/layers.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { ConfigStore } from '../../src/config/store/service.ts';
import { GitLayer } from '../../src/git/layers.ts';
import { MachineGitHub, type MachineGitHubShape } from '../../src/github/identity/schema.ts';
import { GitHubLayer } from '../../src/github/layers.ts';
import { LeadWakeDebounce } from '../../src/initiatives/schema.ts';
import { LeadWakes } from '../../src/initiatives/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { CurrentLogin } from '../../src/repos/current-login/service.ts';
import { RepoWorkLayer } from '../../src/repos/layers.ts';
import { EffectRunnerLayer } from '../../src/runtime/effects/layers.ts';
import type { EffectRunnerOptions } from '../../src/runtime/effects/schema.ts';
import { EffectRunner as EffectRunnerTag } from '../../src/runtime/effects/service.ts';
import type { EffectContext, EffectRetry } from '../../src/runtime/engine/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { Evidence } from '../../src/store/evidence/service.ts';
import { WorkspacesServiceLayer } from '../../src/workspaces/layers.ts';
import type { Engine } from './engine.ts';
import { JsonFileLayer } from './files.ts';

const TEST_LEAD_WAKE_DEBOUNCE = Duration.millis(20);

type TestEffectRunnerOptions = EffectRunnerOptions & {
  machineGitHub?: MachineGitHubShape | null;
  leadWakeDebounce?: Duration.Duration;
};

function awaitAbort(signal: AbortSignal) {
  return Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void);
    const abort = () => resume(Effect.void);
    signal.addEventListener('abort', abort, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', abort));
  });
}

function createEffectRunnerLayer(
  engine: Pick<Engine, 'core'>,
  config: ServerConfig,
  runs: RunSupervisor['Service'],
  briefings: BriefingWriter['Service'],
  { machineGitHub = null, leadWakeDebounce = TEST_LEAD_WAKE_DEBOUNCE, ...options }: TestEffectRunnerOptions
) {
  const repositories = Layer.mergeAll(
    Evidence.layer,
    CurrentLogin.layer.pipe(Layer.provideMerge(RepoWorkLayer)),
    WorkspacesServiceLayer,
    LeadWakes.layer.pipe(Layer.provide(Layer.succeed(LeadWakeDebounce, leadWakeDebounce)))
  ).pipe(
    Layer.provideMerge(ConfigStore.layer.pipe(Layer.provide(JsonFileLayer))),
    Layer.provideMerge(Layer.mergeAll(ChecksLayer, GitHubLayer)),
    Layer.provideMerge(GitLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(EngineConfig, config),
        Layer.succeed(EngineCore, engine.core),
        Layer.succeed(RunSupervisorTag, runs),
        Layer.succeed(BriefingWriterTag, briefings)
      )
    ),
    Layer.provideMerge(ShellLayer)
  );
  return EffectRunnerLayer(options).pipe(
    Layer.provide(Layer.succeed(MachineGitHub, machineGitHub)),
    Layer.provide(repositories)
  );
}

export class EffectRunner {
  readonly #runtime: ManagedRuntime.ManagedRuntime<EffectRunnerTag, never>;

  constructor(
    engine: Pick<Engine, 'core'>,
    config: ServerConfig,
    runs: RunSupervisor['Service'],
    briefings: BriefingWriter['Service'],
    options: TestEffectRunnerOptions
  ) {
    this.#runtime = ManagedRuntime.make(
      Layer.mergeAll(createEffectRunnerLayer(engine, config, runs, briefings, options), JsonLogger)
    );
  }

  #use<A, E>(run: (runner: EffectRunnerTag['Service']) => Effect.Effect<A, E>) {
    return this.#runtime.runPromise(EffectRunnerTag.use(run));
  }

  apply(effect: ShinsaEffect, context: EffectContext): Promise<void> {
    if (context.signal.aborted) return Promise.resolve();
    const attempt = { key: context.key, attempt: context.attempt };
    return this.#use((runner) =>
      runner.apply(effect, attempt).pipe(Effect.raceFirst(awaitAbort(context.signal)))
    );
  }

  start() {
    return this.#runtime.runPromise(EffectRunnerTag.use(Effect.succeed));
  }

  startWatching() {
    return this.#use((runner) => runner.startWatching);
  }

  stop() {
    return this.#use((runner) => runner.stop);
  }

  reportRetry(effect: ShinsaEffect, retry: EffectRetry, key: string) {
    return this.#use((runner) => runner.reportRetry(effect, retry, key));
  }

  reportExhausted(effect: ShinsaEffect, error: string, key: string) {
    return this.#use((runner) => runner.reportExhausted(effect, error, key));
  }

  recover() {
    return this.#use((runner) => runner.recover);
  }

  syncAll() {
    return this.#use((runner) => runner.syncAll);
  }

  syncPullRequest(taskId: string, force = false) {
    return this.#use((runner) => runner.syncPullRequest(taskId, force));
  }

  dispose() {
    return this.#runtime.dispose();
  }
}
