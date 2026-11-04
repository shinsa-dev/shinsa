import { mkdirSync } from 'node:fs';
import { Duration, Effect, Layer } from 'effect';
import { constant } from 'effect/Function';
import { Accounts, AccountsInput, AccountsLayer } from '../accounts/index.ts';
import { AccountBroker } from '../agents/accounts/schema.ts';
import { IDLE_RELEASE, IdleReleaseSettings, MAX_IDLE_PIN_MS } from '../agents/idle/schema.ts';
import { Providers, ProvidersLayer, RunHooks, RunSupervisor, Transcripts } from '../agents/index.ts';
import { ManageAccess } from '../agents/manage/index.ts';
import { ClaudeProviderOptions } from '../agents/providers/claude/index.ts';
import { ProgramVersions } from '../agents/providers/versions/service.ts';
import { QuickCalls, QuickFastMode } from '../agents/quick/index.ts';
import { RunSupervisorLayer } from '../agents/supervisor/layers.ts';
import { TeammateTasks } from '../agents/tool-calls/schema.ts';
import { BriefingWriter } from '../briefing/service.ts';
import { resolveEngineChangelog } from '../changelog/index.ts';
import { ChecksLayer } from '../checks/layers.ts';
import { prepareDataDir, type ServerConfig } from '../config/index.ts';
import { EngineConfig } from '../config/service.ts';
import { ConfigStore } from '../config/store/service.ts';
import { EunoeServer } from '../eunoe/service.ts';
import { ExtensionsLayer, ExtensionsServices } from '../extensions/layers.ts';
import { SIGN_IN_CALLBACK_PATH } from '../extensions/sign-in.ts';
import { FeedbackDrafter } from '../feedback/draft/service.ts';
import { JsonFile } from '../files/service.ts';
import { GitCommands, GitLayer } from '../git/layers.ts';
import { GitHubLayer } from '../github/layers.ts';
import { EngineModels, ServedChangelog, ServedInstance } from '../http/schema.ts';
import { EngineServer } from '../http/server/service.ts';
import { resolveServerUrl } from '../http/server/url.ts';
import {
  BUNDLE,
  createServiceRestart,
  EngineRestarter,
  INSTALL_PATH,
  resolveServerInstance,
  type ServerInstance,
} from '../instance/index.ts';
import { ServeLock } from '../instance/lock/service.ts';
import { createSummaryAccountSource, Onboarding, Prerequisites, SetupCommands } from '../onboarding/index.ts';
import { ProjectChanges } from '../projects/changes/service.ts';
import {
  createInstalledConnector,
  Handoffs,
  PlacementAsker,
  Previews,
  Remote,
  RemoteEdgeLayer,
  RemoteLayer,
  RemoteOrigin,
  RemoteQuickLayer,
  RemoteStore,
  resolveMachineName,
  ShareDescriber,
  Shares,
  TeamFeeds,
} from '../remote/index.ts';
import { ShareClock } from '../remote/share-clock/service.ts';
import { CurrentLogin } from '../repos/current-login/service.ts';
import { RepoFolders } from '../repos/folders/service.ts';
import { Roots } from '../repos/index.ts';
import { GitHubLogins } from '../repos/login/service.ts';
import { RepoRegistry } from '../repos/registry/service.ts';
import { RepoSetup } from '../repos/setup/service.ts';
import { ProcessLedger, ResourceMachine, ResourceMonitor } from '../resources/index.ts';
import { EffectRunnerLayer } from '../runtime/effects/layers.ts';
import { EngineCore } from '../runtime/engine/service.ts';
import { MonitorClock } from '../runtime/monitors/service.ts';
import { WatchdogClock } from '../runtime/watchdogs/service.ts';
import { ScheduleClockTimings } from '../schedules/clock/schema.ts';
import { SchedulesLayer } from '../schedules/layers.ts';
import { ScheduleTimeZone } from '../schedules/schema.ts';
import { Schedules } from '../schedules/service.ts';
import { createWatchWriter } from '../schedules/suggest.ts';
import { SecretFiles } from '../secrets/files/service.ts';
import { SecretStore } from '../secrets/store/service.ts';
import { ShellLayer } from '../shell/layers.ts';
import { Slack } from '../slack/service.ts';
import { ATTACHMENT_REQUEST_LIMIT_BYTES, Evidence } from '../store/index.ts';
import { StoreLayer } from '../store/layers.ts';
import { resolveStateVersion } from '../store/snapshot/version.ts';
import { TerminalsLayer } from '../terminals/layers.ts';
import { ServiceRefiner } from '../terminals/refine/service.ts';
import { Terminals } from '../terminals/service.ts';
import { CommandRouter, MessageInbox, TaskTriage, TriageClassifier, TriageTeam } from '../triage/index.ts';
import { VersionsLayer } from '../versions/layers.ts';
import { Versions } from '../versions/service.ts';
import { WorkspacesServiceLayer } from '../workspaces/layers.ts';
import { ServerAddress } from './address/service.ts';
import type { ShinsaOptions } from './schema.ts';
import { WorkLayer } from './work.ts';

export function createMachineLayer({
  discover,
  resolveLogin,
}: Pick<ShinsaOptions, 'discover' | 'resolveLogin'>) {
  const folders = discover
    ? Layer.effect(
        RepoFolders,
        Effect.map(RepoFolders.use(Effect.succeed), (found) =>
          RepoFolders.of({ ...found, discover: (home) => Effect.promise(() => discover(home)) })
        )
      ).pipe(Layer.provide(RepoFolders.layer))
    : RepoFolders.layer;
  const login = resolveLogin
    ? Layer.succeed(CurrentLogin, CurrentLogin.of({ lookup: Effect.promise(resolveLogin) }))
    : CurrentLogin.layer;
  const repos = Layer.mergeAll(folders, RepoSetup.layer, GitHubLogins.layer);
  const stores = Layer.mergeAll(
    ConfigStore.layer,
    SecretStore.layer.pipe(Layer.provide(SecretFiles.layer)),
    Evidence.layer,
    RepoRegistry.layer,
    login
  );
  return Layer.mergeAll(Roots.layer, ProjectChanges.layer, WorkspacesServiceLayer).pipe(
    Layer.provideMerge(stores),
    Layer.provideMerge(repos),
    Layer.provide(JsonFile.layer),
    Layer.provide(Layer.merge(GitLayer, GitHubLayer)),
    Layer.provide(ShellLayer)
  );
}

function createFoundationLayer(config: ServerConfig) {
  return Layer.mergeAll(
    Layer.succeed(EngineConfig, config),
    JsonFile.layer,
    ChecksLayer.pipe(Layer.provideMerge(GitLayer)),
    GitHubLayer
  ).pipe(Layer.provideMerge(ShellLayer));
}

function createLogLayer(config: ServerConfig) {
  const stateVersion = BUNDLE ? Effect.succeed(BUNDLE.stateVersion) : resolveStateVersion();
  const core = Layer.unwrap(
    Effect.map(stateVersion, (version) =>
      EngineCore.layer({ readOnly: config.inspect, stateVersion: version })
    )
  );
  return core.pipe(
    Layer.provideMerge(StoreLayer(config.databasePath)),
    Layer.provideMerge(
      Layer.effectDiscard(Effect.addFinalizer(() => Effect.logInfo('[Serve] Closed the event log')))
    )
  );
}

function createAgentsLayer(options: ShinsaOptions) {
  const providers = options.providers
    ? Layer.succeed(Providers, options.providers)
    : ProvidersLayer.pipe(
        Layer.provide(
          Layer.effect(
            ClaudeProviderOptions,
            Effect.gen(function* () {
              return { eunoe: yield* EunoeServer };
            })
          )
        )
      );
  const accountsInput = Layer.effect(
    AccountsInput,
    Effect.gen(function* () {
      const found = yield* Providers;
      return {
        usageSources: found.listUsageSources(),
        listProviderLogins: found.listLogins,
        forward: options.onNotice ?? constant(Effect.void),
      } satisfies typeof AccountsInput.Service;
    })
  );
  const accounts = AccountsLayer.pipe(
    Layer.provide(options.accountLayer ?? Layer.empty),
    Layer.provide(Layer.mergeAll(accountsInput, TerminalsLayer, ProgramVersions.layer))
  );
  const fastMode = Layer.effect(
    QuickFastMode,
    Effect.gen(function* () {
      return (yield* Accounts).readFastMode;
    })
  );
  const quick = QuickCalls.layer.pipe(Layer.provide(fastMode));
  return Layer.mergeAll(
    RemoteQuickLayer,
    BriefingWriter.layer,
    FeedbackDrafter.layer,
    Layer.unwrap(
      Effect.gen(function* () {
        return ServiceRefiner.layer((yield* QuickCalls).classify);
      })
    )
  ).pipe(
    Layer.provideMerge(quick),
    Layer.provideMerge(accounts),
    Layer.provideMerge(providers),
    Layer.provideMerge(Layer.mergeAll(EunoeServer.layer, Transcripts.layer, ProgramVersions.layer))
  );
}

function createRemoteLayer(config: ServerConfig, options: ShinsaOptions, instance: ServerInstance) {
  const remote = Layer.unwrap(
    Effect.gen(function* () {
      const address = yield* ServerAddress;
      return RemoteLayer({
        version: instance.version,
        machineName: resolveMachineName(),
        maxBodyBytes: ATTACHMENT_REQUEST_LIMIT_BYTES,
        localUrl: address.url,
      });
    })
  );
  return remote.pipe(
    Layer.provide(
      Layer.mergeAll(
        options.remoteConnector ?? createInstalledConnector(config.dataDir),
        RemoteEdgeLayer,
        Layer.succeed(RemoteOrigin, config.remoteOrigin)
      )
    )
  );
}

function createExtensionsLayer(options: ShinsaOptions) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const address = yield* ServerAddress;
      return ExtensionsServices({
        env: options.extensions?.env ?? process.env,
        fetch: options.extensions?.fetch,
        redirectUrl: Effect.map(address.url, (url) => `${url}${SIGN_IN_CALLBACK_PATH}`),
      });
    })
  ).pipe(Layer.provide(ExtensionsLayer));
}

function createVersionsLayer(options: ShinsaOptions) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      return Versions.layer({ onUpdated: () => accounts.syncProviderLogins });
    })
  ).pipe(Layer.provide(options.versions ?? VersionsLayer));
}

function createTriageLayer() {
  const team = Layer.effect(
    TriageTeam,
    Effect.gen(function* () {
      const remoteStore = yield* RemoteStore;
      const teamFeeds = yield* TeamFeeds;
      return Effect.gen(function* () {
        const file = yield* remoteStore.file;
        return {
          feed: yield* teamFeeds.snapshot,
          teams: file.teams,
          self: file.credentials?.instanceId ?? null,
        };
      });
    })
  );
  return Layer.mergeAll(MessageInbox.layer, CommandRouter.layer, TaskTriage.layer).pipe(
    Layer.provideMerge(TriageClassifier.layer),
    Layer.provide(team)
  );
}

function createSlackLayer(config: ServerConfig) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const remote = yield* Remote;
      const remoteStore = yield* RemoteStore;
      return Slack.layer({
        credentials: Effect.gen(function* () {
          return (yield* remote.isEnabled) ? (yield* remoteStore.file).credentials : null;
        }),
        appOrigin: config.remoteOrigin,
      });
    })
  );
}

function createClocksLayer(options: ShinsaOptions) {
  const schedules = Layer.unwrap(
    Effect.gen(function* () {
      const address = yield* ServerAddress;
      const remote = yield* Remote;
      return SchedulesLayer({
        baseUrl: address.url,
        hookUrl: (scheduleId, token) => remote.resolveHookUrl(scheduleId, token),
      });
    })
  );
  return Layer.mergeAll(schedules, MonitorClock.layer, WatchdogClock.layer, ShareClock.layer).pipe(
    Layer.provide(
      Layer.mergeAll(
        options.scheduleClock ? Layer.succeed(ScheduleClockTimings, options.scheduleClock) : Layer.empty,
        options.timeZone ? Layer.succeed(ScheduleTimeZone, options.timeZone) : Layer.empty
      )
    )
  );
}

function createTerminalsLayer(instance: ServerInstance) {
  return ResourceMonitor.layer.pipe(
    Layer.provideMerge(ProcessLedger.layer),
    Layer.provideMerge(Terminals.layer({ version: instance.version, env: process.env })),
    Layer.provide(Layer.merge(ResourceMachine.layer, TerminalsLayer))
  );
}

function createRunsLayer(options: ShinsaOptions) {
  const access = Layer.effect(
    ManageAccess,
    Effect.gen(function* () {
      const address = yield* ServerAddress;
      const projects = yield* ProjectChanges;
      const router = yield* CommandRouter;
      const schedules = yield* Schedules;
      return ManageAccess.of({
        baseUrl: address.current,
        projects,
        route: router.route,
        hookSecrets: (taskId) => schedules.hookSecrets(taskId),
      });
    })
  );
  const broker = Layer.effect(
    AccountBroker,
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      return {
        lease: accounts.lease,
        readWeeklyReading: accounts.readWeeklyReading,
        readProviderWeeklyReading: accounts.readProviderWeeklyReading,
        readFastMode: accounts.readFastMode,
      };
    })
  );
  const hooks = Layer.effect(
    RunHooks,
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      return {
        startSession: options.startSession ?? null,
        onRejection: options.onRejection ?? accounts.onRejection,
        onNotice: options.onNotice ?? accounts.onNotice,
      };
    })
  );
  const idle = options.idle
    ? Layer.succeed(IdleReleaseSettings, {
        idle: options.idle.idleMs === undefined ? IDLE_RELEASE : Duration.millis(options.idle.idleMs),
        maxPinMs: options.idle.maxPinMs ?? MAX_IDLE_PIN_MS,
      })
    : Layer.empty;
  const teammates = Layer.effect(
    TeammateTasks,
    Effect.gen(function* () {
      const feeds = yield* TeamFeeds;
      const remote = yield* Remote;
      return Effect.flatMap(feeds.listTasks({}), Effect.filter(remote.canForkTeamTask));
    })
  );
  return RunSupervisorLayer.pipe(Layer.provide(Layer.mergeAll(access, broker, hooks, idle, teammates)));
}

function createEffectsLayer(options: ShinsaOptions, instance: ServerInstance) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const quick = yield* QuickCalls;
      const terminals = yield* Terminals;
      return EffectRunnerLayer({
        shares: yield* Shares,
        previews: yield* Previews,
        handoffs: yield* Handoffs,
        triage: options.triage ?? (yield* TaskTriage).resolve,
        findRepository: (yield* TriageClassifier).repository,
        wordWatch: createWatchWriter(quick.write),
        describeShare: (yield* ShareDescriber).describe,
        draftFeedback: yield* FeedbackDrafter,
        instance,
        ...(options.resolveLogin ? { resolveLogin: options.resolveLogin } : {}),
        roots: yield* Roots,
        services: terminals,
        slack: yield* Slack,
        trackProcess: (yield* ProcessLedger).track,
      });
    })
  );
}

function createServedLayer(options: ShinsaOptions, instance: ServerInstance, stop: Effect.Effect<void>) {
  const models = Layer.effect(
    EngineModels,
    Effect.gen(function* () {
      if (options.models) return options.models;
      const providers = yield* Providers;
      const state = yield* (yield* EngineCore).state;
      return yield* providers.resolve(state.settings.defaultProvider).pipe(Effect.orDie);
    })
  );
  const restarter = Layer.unwrap(
    Effect.gen(function* () {
      return EngineRestarter.layer(
        createServiceRestart({
          byService: options.byService ?? false,
          drain: yield* RunSupervisor,
          stop,
          exit: options.exit,
        })
      );
    })
  );
  const onboarding = Layer.unwrap(
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      return Onboarding.layer({
        models: yield* EngineModels,
        accounts: options.accounts ?? createSummaryAccountSource(accounts.snapshot),
        terminals: yield* Terminals,
      });
    })
  ).pipe(Layer.provide(Prerequisites.layer), Layer.provide(SetupCommands.layer));
  const served = Layer.mergeAll(
    Layer.succeed(ServedInstance, instance),
    Layer.succeed(
      ServedChangelog,
      resolveEngineChangelog({
        built: process.env.SHINSA_BUILD_CHANGELOG,
        root: BUNDLE ? null : INSTALL_PATH,
      })
    ),
    options.place ? Layer.succeed(PlacementAsker, options.place) : Layer.empty,
    restarter
  );
  return Layer.merge(served, onboarding).pipe(Layer.provideMerge(models));
}

function createServeLayer(
  config: ServerConfig,
  options: ShinsaOptions,
  instance: ServerInstance,
  stop: Effect.Effect<void>
) {
  return WorkLayer.pipe(
    Layer.provideMerge(EngineServer.layer),
    Layer.provideMerge(createServedLayer(options, instance, stop)),
    Layer.provideMerge(createEffectsLayer(options, instance)),
    Layer.provideMerge(createRunsLayer(options)),
    Layer.provideMerge(Previews.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        createTriageLayer(),
        createSlackLayer(config),
        createClocksLayer(options),
        createTerminalsLayer(instance)
      )
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        createRemoteLayer(config, options, instance),
        createExtensionsLayer(options),
        createVersionsLayer(options)
      )
    ),
    Layer.provideMerge(createAgentsLayer(options)),
    Layer.provideMerge(Layer.merge(createMachineLayer(options), ServerAddress.layer)),
    Layer.provideMerge(createLogLayer(config)),
    Layer.provideMerge(createFoundationLayer(config))
  );
}

export function EngineLayer(config: ServerConfig, options: ShinsaOptions, stop: Effect.Effect<void>) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const instance = yield* resolveServerInstance().pipe(Effect.provide(GitCommands));
      yield* Effect.sync(() => mkdirSync(config.dataDir, { recursive: true }));
      const lock = config.inspect
        ? Layer.empty
        : ServeLock.layer(config.dataDir, {
            ...instance,
            port: config.port,
            url: resolveServerUrl(config.hostname, config.port),
          });
      return createServeLayer(config, options, instance, stop).pipe(
        Layer.provideMerge(Layer.effectDiscard(prepareDataDir(config)).pipe(Layer.provide(ShellLayer))),
        Layer.provideMerge(lock)
      );
    })
  );
}
