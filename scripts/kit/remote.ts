import { BunServices } from '@effect/platform-bun';
import { Context, Effect, Layer, Scope } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { ProvidersLayer } from '../../apps/engine/src/agents/providers/index.ts';
import { QuickCalls } from '../../apps/engine/src/agents/quick/index.ts';
import { Transcripts } from '../../apps/engine/src/agents/transcripts/service.ts';
import type { ServerConfig } from '../../apps/engine/src/config/index.ts';
import { EngineConfig } from '../../apps/engine/src/config/service.ts';
import { JsonFile } from '../../apps/engine/src/files/service.ts';
import { GitLayer } from '../../apps/engine/src/git/layers.ts';
import { GitHubLayer } from '../../apps/engine/src/github/layers.ts';
import { JsonLogger } from '../../apps/engine/src/log/service.ts';
import { FleetRelay } from '../../apps/engine/src/remote/fleet-relay/service.ts';
import { TunnelHealth } from '../../apps/engine/src/remote/health/service.ts';
import {
  createRefusedConnector,
  Handoffs,
  PlacementAsker,
  Previews,
  Remote,
  RemoteLayer,
  RemoteMachineLayer,
  RemoteOrigin,
  RemoteQuickLayer,
  RemoteStore,
  RemoteUrlOpener,
  ShareDescriber,
  Shares,
  TeamFeeds,
  Teams,
} from '../../apps/engine/src/remote/index.ts';
import { ShareClock } from '../../apps/engine/src/remote/share-clock/service.ts';
import { ShareCodeUnreadable, ShareSources } from '../../apps/engine/src/remote/shares/schema.ts';
import type { EffectAttempt, EffectContext } from '../../apps/engine/src/runtime/engine/schema.ts';
import { EngineCore } from '../../apps/engine/src/runtime/engine/service.ts';
import { ShellLayer } from '../../apps/engine/src/shell/layers.ts';
import { Evidence } from '../../apps/engine/src/store/evidence/service.ts';
import { Terminals } from '../../apps/engine/src/terminals/service.ts';
import type { Engine } from '../../apps/engine/test/helpers/engine.ts';
import {
  createSettings,
  type Repo,
  type ShinsaEffect,
  type ShinsaState,
} from '../../packages/core/src/index.ts';

export interface RemoteMachineInput {
  engine: Engine;
  config: ServerConfig;
  machineName: string;
  version: string;
  maxBodyBytes: number;
  localUrl: string;
  refusal: string;
}

export interface RemoteServicesInput extends RemoteMachineInput {
  evidence: Evidence['Service'];
  transcripts: Transcripts['Service'];
  terminals: Terminals['Service'];
}

function createEdgeLayer(input: RemoteMachineInput) {
  return Layer.mergeAll(
    createRefusedConnector(input.refusal),
    TunnelHealth.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    Layer.succeed(RemoteUrlOpener, { open: () => Effect.void }),
    Layer.succeed(RemoteOrigin, input.config.remoteOrigin)
  );
}

function createFoundationLayer(input: RemoteMachineInput) {
  return Layer.mergeAll(
    Layer.succeed(EngineConfig, input.config),
    Layer.succeed(EngineCore, input.engine.core),
    JsonFile.layer,
    JsonLogger
  ).pipe(Layer.provideMerge(BunServices.layer));
}

function resolveRemoteInput(input: RemoteMachineInput) {
  return {
    version: input.version,
    machineName: input.machineName,
    maxBodyBytes: input.maxBodyBytes,
    localUrl: Effect.succeed(input.localUrl),
  };
}

const buildContext = Effect.fn('Kit.buildContext')(function* <A, E>(layer: Layer.Layer<A, E>) {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(layer, scope);
  return { context, scope };
});

function findBranch(
  state: ShinsaState,
  repo: Repo,
  matches: (task: ShinsaState['tasks'][string]) => boolean
) {
  return Object.values(state.tasks).find((task) => task.repoId === repo.id && matches(task))?.branch;
}

const runGit = Effect.fn('Kit.runGit')(function* (args: string[], failure: string) {
  const result = yield* Effect.sync(() => Bun.spawnSync(['git', ...args]));
  if (result.exitCode !== 0) return yield* new ShareCodeUnreadable({ message: failure });
  return result.stdout.toString();
});

function createBranchCodeSource(engine: EngineCore['Service']) {
  return {
    readDiff: Effect.fn('Kit.readDiff')(function* (repo: Repo, number: number) {
      const state = yield* engine.state;
      const branch =
        findBranch(state, repo, (task) => task.pullRequest?.number === number) ?? repo.defaultBranch;
      const range = `${repo.defaultBranch}...${branch}`;
      return yield* runGit(['-C', repo.path, 'diff', range], `git diff ${range} failed in ${repo.path}.`);
    }),
    readFile: Effect.fn('Kit.readFile')(function* (repo: Repo, ref: string, path: string) {
      const state = yield* engine.state;
      const branch = findBranch(state, repo, (task) => task.pullRequest?.headSha === ref) ?? ref;
      return yield* runGit(['-C', repo.path, 'show', `${branch}:${path}`], `git show failed for ${path}.`);
    }),
  };
}

export function startRemoteMachine(input: RemoteMachineInput) {
  const layer = RemoteMachineLayer(resolveRemoteInput(input)).pipe(
    Layer.provide(createEdgeLayer(input)),
    Layer.provide(createFoundationLayer(input))
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const { context } = yield* buildContext(layer);
      const remote = Context.get(context, Remote);
      const remoteStore = Context.get(context, RemoteStore);
      return {
        services: { remote, remoteStore },
        resolveMachineKey: () =>
          Effect.runPromise(Effect.map(remoteStore.resolveMachineKey, (key) => key.publicKey)),
      };
    })
  );
}

export type StartedRemote = Awaited<ReturnType<typeof startRemoteServices>>;

export function startRemoteServices(input: RemoteServicesInput) {
  const quickCore = Layer.succeed(EngineCore, {
    state: Effect.sync(() => ({ settings: createSettings() })),
  } as unknown as EngineCore['Service']);
  const quick = RemoteQuickLayer.pipe(
    Layer.provide(QuickCalls.layer),
    Layer.provide(Layer.merge(ProvidersLayer, quickCore)),
    Layer.provide(ShellLayer)
  );
  const remote = Layer.mergeAll(Previews.layer, ShareClock.layer).pipe(
    Layer.provideMerge(RemoteLayer(resolveRemoteInput(input))),
    Layer.provide(createEdgeLayer(input)),
    Layer.provide(
      Layer.succeed(ShareSources, { github: createBranchCodeSource(input.engine.core), worktree: null })
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        createFoundationLayer(input),
        Layer.succeed(Transcripts, input.transcripts),
        Layer.succeed(Evidence, input.evidence),
        Layer.succeed(Terminals, input.terminals),
        Layer.merge(GitLayer, GitHubLayer)
      ).pipe(Layer.provideMerge(ShellLayer))
    )
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const { context, scope } = yield* buildContext(Layer.merge(remote, quick));
      const run = Effect.runPromiseWith(context);
      const machine = Context.get(context, Remote);
      const remoteStore = Context.get(context, RemoteStore);
      const shares = Context.get(context, Shares);
      const previews = Context.get(context, Previews);
      const handoffs = Context.get(context, Handoffs);
      const teamFeeds = Context.get(context, TeamFeeds);
      const describer = Context.get(context, ShareDescriber);
      const core = input.engine.core;

      const describeShare = Effect.fn('Sandbox.describeShare')(function* (taskId: string, key: string) {
        const task = (yield* core.state).tasks[taskId];
        if (!task?.share) return;
        const description = yield* describer.describe(task);
        if (!description) return;
        yield* core.dispatch(
          { type: 'share.describe', taskId, description },
          { id: `${key}:share.describe` }
        );
      });

      const applyEffect = Effect.fn('Sandbox.applyEffect')(function* (
        effect: ShinsaEffect,
        attempt: EffectAttempt
      ) {
        if (effect.kind === 'share.link') yield* shares.link(effect.taskId, attempt);
        if (effect.kind === 'share.describe') yield* describeShare(effect.taskId, attempt.key);
        if (effect.kind === 'preview.link') yield* previews.link(effect.taskId, effect.serviceId, attempt);
        if (effect.kind === 'handoff.link') yield* handoffs.link(effect.taskId, attempt);
        if (effect.kind === 'handoff.revoke') yield* handoffs.revoke(effect.taskId, effect.guestId);
      });

      const accepting = new Set<string>();
      const acceptNewRequests = Effect.gen(function* () {
        for (const request of (yield* machine.snapshot).requests) {
          if (accepting.has(request.id)) continue;
          accepting.add(request.id);
          yield* Effect.forkDetach(
            machine
              .acceptRequest(request.id)
              .pipe(
                Effect.catch((error) =>
                  Effect.sync(() => console.error(`Could not accept ${request.deviceName}: ${String(error)}`))
                )
              )
          );
        }
      });
      yield* machine.observe(acceptNewRequests).pipe(Scope.provide(scope));

      return {
        services: {
          remote: machine,
          remoteStore,
          shares,
          teams: Context.get(context, Teams),
          teamFeeds,
          fleetRelay: Context.get(context, FleetRelay),
          previews,
          place: Context.get(context, PlacementAsker),
        },
        snapshot: () => Effect.runSync(machine.snapshot),
        createLink: () => run(machine.createLink),
        resolveMachineKey: () => run(Effect.map(remoteStore.resolveMachineKey, (key) => key.publicKey)),
        resolveSigningKey: () => run(Effect.map(remoteStore.resolveSigningKey, (key) => key.publicKey)),
        applyEffect: (effect: ShinsaEffect, effectContext: EffectContext) =>
          run(applyEffect(effect, { key: effectContext.key, attempt: effectContext.attempt })),
        start: () => run(Effect.andThen(Context.get(context, ShareClock).start, teamFeeds.start)),
      };
    })
  );
}
