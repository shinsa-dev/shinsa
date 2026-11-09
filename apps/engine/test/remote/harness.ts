import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AccessScopes,
  ConnectChannel,
  ConnectClaim,
  RemoteDevice,
  RemoteTeam,
  ShareLiveView,
  ViewScope,
  TaskGuest,
  TeamViewTarget,
} from '@shinsa/core';
import { Context, Effect, Exit, Fiber, Layer, Option, Scope } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Transcripts } from '../../src/agents/transcripts/service.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { JsonFile } from '../../src/files/service.ts';
import { GitLayer } from '../../src/git/layers.ts';
import { GitHubLayer } from '../../src/github/layers.ts';
import { describeError } from '../../src/log/redact.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { AccessScope } from '../../src/remote/access/service.ts';
import type {
  ChannelHub,
  ChannelPeer,
  ChannelRaw,
  ChannelTerminals,
  RemoteChannelHandle,
} from '../../src/remote/channel/schema.ts';
import { RemoteOrigin } from '../../src/remote/client/schema.ts';
import { createRefusedConnector } from '../../src/remote/connector/refused.ts';
import type { TunnelConnectorLayer } from '../../src/remote/connector/schema.ts';
import { Handoffs } from '../../src/remote/handoffs/service.ts';
import type { HealthCheck } from '../../src/remote/health/schema.ts';
import { TunnelHealth } from '../../src/remote/health/service.ts';
import { RemoteClientLayer } from '../../src/remote/layers.ts';
import { HandoffClaimFailed, RemoteUrlUnopened } from '../../src/remote/machine/schema.ts';
import { Remote } from '../../src/remote/machine/service.ts';
import { RemoteUrlOpener } from '../../src/remote/opener/service.ts';
import { PairPollInterval } from '../../src/remote/pairing/schema.ts';
import { Presence } from '../../src/remote/presence/service.ts';
import { Previews } from '../../src/remote/previews/service.ts';
import type { ChannelInput, ShareChannelHandle } from '../../src/remote/share-channel/schema.ts';
import { Shares } from '../../src/remote/shares/service.ts';
import {
  REMOTE_FILE,
  type RemoteFile,
  type StoredTeamKey,
  type TeamGrant,
  type RelayDevice,
  type TeammateExtra,
} from '../../src/remote/store/schema.ts';
import { RemoteStore } from '../../src/remote/store/service.ts';
import type {
  TeamStreamHandlers,
  TeamStreamTarget,
  TeamTaskFilter,
} from '../../src/remote/team-feeds/schema.ts';
import { TeamFeeds } from '../../src/remote/team-feeds/service.ts';
import { Teams } from '../../src/remote/teams/service.ts';
import type { EngineCore } from '../../src/runtime/engine/service.ts';
import { EngineCore as EngineCoreTag } from '../../src/runtime/engine/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { Evidence } from '../../src/store/evidence/service.ts';
import type { Terminals } from '../../src/terminals/service.ts';
import { Terminals as TerminalsTag } from '../../src/terminals/service.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { createTempDir } from '../helpers/index.ts';
import { createTestTranscripts } from '../helpers/transcripts.ts';

export interface RemoteTestOptions {
  dataDir?: string;
  file?: Record<string, unknown>;
  origin?: string;
  fetch?: typeof fetch;
  pairPollMs?: number;
  connector?: TunnelConnectorLayer;
  ping?: HealthCheck['check'];
  openUrl?: (url: string) => Promise<void>;
  machineName?: string;
  version?: string;
  maxBodyBytes?: number;
  localUrl?: () => string;
  engine?: EngineCore['Service'];
  transcripts?: Partial<Transcripts['Service']>;
  evidence?: Partial<Evidence['Service']>;
  terminals?: Partial<Terminals['Service']>;
  config?: Partial<ServerConfig>;
  store?: (store: RemoteStore['Service']) => RemoteStore['Service'];
  remote?: (remote: Remote['Service']) => Remote['Service'];
  shares?: (shares: Shares['Service']) => Shares['Service'];
  teamFeeds?: (feeds: TeamFeeds['Service']) => TeamFeeds['Service'];
  layers?: Layer.Layer<never>;
  handoffs?: boolean;
}

function createStubCore(): EngineCore['Service'] {
  return {
    readOnly: false,
    problems: [],
    state: Effect.die('No engine in this test.'),
    observe: () => Effect.void,
    dispatch: () => Effect.die('No engine in this test.'),
  } as unknown as EngineCore['Service'];
}

function wrapLayer<I, S, E, R>(
  tag: Context.Key<I, S>,
  layer: Layer.Layer<I, E, R>,
  wrap: ((service: S) => S) | undefined
): Layer.Layer<I, E, R> {
  if (!wrap) return layer;
  return Layer.effect(tag, Effect.map(Effect.service(tag), wrap)).pipe(Layer.provide(layer));
}

export function createRemoteFoundation(
  dataDir: string,
  config: Partial<ServerConfig>,
  options: Pick<RemoteTestOptions, 'engine' | 'transcripts' | 'evidence' | 'terminals'> = {}
) {
  return Layer.mergeAll(
    Layer.succeed(EngineConfig, config as ServerConfig),
    Layer.succeed(EngineCoreTag, options.engine ?? createStubCore()),
    Layer.succeed(Transcripts, {
      ...createTestTranscripts(join(dataDir, 'transcripts')),
      ...options.transcripts,
    }),
    Layer.succeed(Evidence, {
      selectFile: () => Effect.succeed(Option.none()),
      ...options.evidence,
    } as Evidence['Service']),
    Layer.succeed(TerminalsTag, {
      snapshot: Effect.succeed({ terminals: [], services: [], home: dataDir }),
      applyRemoteUrls: () => Effect.void,
      ...options.terminals,
    } as unknown as Terminals['Service']),
    Layer.merge(GitLayer, GitHubLayer),
    JsonFile.layer,
    JsonLogger
  ).pipe(Layer.provideMerge(ShellLayer));
}

export async function createRemoteTest(options: RemoteTestOptions = {}) {
  const dataDir = options.dataDir ?? createTempDir();
  const path = join(dataDir, REMOTE_FILE);
  if (options.file) writeFileSync(path, JSON.stringify(options.file));
  const config = { dataDir, userHome: dataDir, previewOrigin: 'https://shinsa.page', ...options.config };
  const opener = options.openUrl;
  const settings = Layer.mergeAll(
    options.origin === undefined ? Layer.empty : Layer.succeed(RemoteOrigin, options.origin),
    options.fetch ? Layer.succeed(FetchHttpClient.Fetch, options.fetch) : Layer.empty,
    options.pairPollMs === undefined ? Layer.empty : Layer.succeed(PairPollInterval, options.pairPollMs),
    options.layers ?? Layer.empty,
    JsonLogger
  );
  const edge = Layer.mergeAll(
    options.connector ?? createRefusedConnector('no tunnel in this test'),
    options.ping
      ? Layer.succeed(TunnelHealth, { check: options.ping })
      : TunnelHealth.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    Layer.succeed(RemoteUrlOpener, {
      open: (url) =>
        opener
          ? Effect.tryPromise({
              try: () => opener(url),
              catch: (error) => new RemoteUrlUnopened({ message: describeError(error) }),
            })
          : Effect.void,
    })
  );
  const foundation = createRemoteFoundation(dataDir, config, options);
  const input = {
    version: options.version ?? '1',
    machineName: options.machineName ?? 'Studio',
    maxBodyBytes: options.maxBodyBytes ?? 1024,
    localUrl: Effect.sync(options.localUrl ?? (() => 'http://127.0.0.1:1')),
  };
  const machine = wrapLayer(Remote, Remote.layer(input), options.remote).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        wrapLayer(RemoteStore, RemoteStore.layer, options.store),
        AccessScope.layer,
        RemoteClientLayer
      )
    )
  );
  const scope = Effect.runSync(Scope.make());
  const services = Layer.mergeAll(Teams.layer, Previews.layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        wrapLayer(Shares, Shares.layer, options.shares),
        wrapLayer(TeamFeeds, TeamFeeds.layer, options.teamFeeds),
        options.handoffs === false ? Layer.empty : Handoffs.layer,
        Presence.layer
      )
    ),
    Layer.provideMerge(machine),
    Layer.provide(edge),
    Layer.provideMerge(settings),
    Layer.provide(foundation)
  );
  const context: Context.Context<never> = await Effect.runPromise(Layer.buildWithScope(services, scope));
  return createHarness(context, scope, path);
}

export async function openTestStore(path: string) {
  const scope = Effect.runSync(Scope.make());
  const layer = RemoteStore.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EngineConfig, { dataDir: dirname(path) } as ServerConfig),
        JsonFileLayer,
        JsonLogger
      )
    )
  );
  const context: Context.Context<never> = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  return adaptStore(createHarness(context, scope, path));
}

export async function readRemoteFile(path: string) {
  return (await openTestStore(path)).file;
}

function createHarness(context: Context.Context<never>, scope: Scope.Closeable, path: string) {
  const runSync = Effect.runSyncWith(context);
  const runPromise = Effect.runPromiseWith(context);
  const run = <A, E>(effect: Effect.Effect<A, E>): A | Promise<A> => {
    const fiber = Effect.runForkWith(context)(effect);
    const exit = fiber.pollUnsafe();
    if (!exit) return runPromise(Fiber.join(fiber));
    if (Exit.isSuccess(exit)) return exit.value;
    return runPromise(Fiber.join(fiber));
  };
  const get = <I, S>(tag: Context.Key<I, S>) => Context.getUnsafe(context as Context.Context<I>, tag);
  return {
    context,
    path,
    runSync,
    runPromise,
    run,
    get,
    close: () => runPromise(Scope.close(scope, Exit.void)),
  };
}

export type RemoteTest = ReturnType<typeof createHarness>;

function adaptStore(test: RemoteTest) {
  const store = test.get(RemoteStore as never) as RemoteStore['Service'];
  const { runSync, runPromise } = test;
  return {
    path: test.path,
    get file(): RemoteFile {
      return runSync(store.file);
    },
    update: (change: (file: RemoteFile) => RemoteFile) => runPromise(store.update(change)),
    resolveMachineKey: () => runPromise(store.resolveMachineKey),
    resolveSigningKey: () => runPromise(store.resolveSigningKey),
    selectDevice: (publicKey: string) => runSync(store.selectDevice(publicKey)),
    upsertDevice: (device: RemoteDevice) => runPromise(store.upsertDevice(device)),
    removeDevicesOutside: (userIds: ReadonlySet<string>, guestIds: ReadonlySet<string>) =>
      runPromise(store.removeDevicesOutside(userIds, guestIds)),
    removeDevice: (publicKey: string) => runPromise(store.removeDevice(publicKey)),
    recordTeams: (teams: RemoteTeam[]) => runPromise(store.recordTeams(teams)),
    selectTeamKey: (teamId: string) => runSync(store.selectTeamKey(teamId)),
    selectTeam: (teamId: string) => runSync(store.selectTeam(teamId)),
    upsertTeamKey: (stored: StoredTeamKey) => runPromise(store.upsertTeamKey(stored)),
    writeGrant: (grant: TeamGrant) => runPromise(store.writeGrant(grant)),
    selectGrant: (userId: string, teamId: string) => runSync(store.selectGrant(userId, teamId)),
    listGrants: (userId: string) => runSync(store.listGrants(userId)),
    removeGrantsWhere: (match: (grant: TeamGrant) => boolean) => runPromise(store.removeGrantsWhere(match)),
    removeDevicesWhere: (match: (device: RemoteDevice) => boolean) =>
      runPromise(store.removeDevicesWhere(match)),
    selectExtra: (userId: string, teamId: string) => runSync(store.selectExtra(userId, teamId)),
    writeExtra: (extra: TeammateExtra) => runPromise(store.writeExtra(extra)),
    removeExtrasWhere: (match: (extra: TeammateExtra) => boolean) =>
      runPromise(store.removeExtrasWhere(match)),
    selectRelayDevice: (instanceId: string) => runSync(store.selectRelayDevice(instanceId)),
    writeRelayDevice: (device: RelayDevice) => runPromise(store.writeRelayDevice(device)),
    removeRelayDevicesWhere: (match: (device: RelayDevice) => boolean) =>
      runPromise(store.removeRelayDevicesWhere(match)),
    removeTeam: (teamId: string) => runPromise(store.removeTeam(teamId)),
    recordDeviceSeen: (publicKey: string, at: number) => runPromise(store.recordDeviceSeen(publicKey, at)),
  };
}

function adaptChannel(test: RemoteTest, handle: RemoteChannelHandle) {
  return {
    handle,
    get device() {
      return test.runSync(handle.device);
    },
    get isOpen() {
      return test.runSync(handle.isOpen);
    },
    receive: (raw: ChannelRaw) => test.runPromise(handle.receive(raw)),
    fail: (reason: string, error?: unknown) =>
      test.runSync(handle.fail(reason, error ? describeError(error) : undefined)),
    close: () => test.runSync(handle.close),
  };
}

function adaptShareChannel<Subject>(test: RemoteTest, handle: ShareChannelHandle<Subject>) {
  return {
    handle,
    get subject() {
      return test.runSync(handle.subject);
    },
    receive: (raw: ChannelInput) => test.runPromise(handle.receive(raw)),
    push: () => test.runPromise(handle.push),
    end: (reason: string) => test.runPromise(handle.end(reason)),
    fail: (reason: string, error?: unknown) =>
      test.runSync(handle.fail(reason, error ? describeError(error) : undefined)),
    close: () => test.runSync(handle.close),
  };
}

export function adaptRemote(test: RemoteTest) {
  const remote = test.get(Remote as never) as Remote['Service'];
  const access = test.get(AccessScope as never) as AccessScope['Service'];
  const origin = test.runSync(
    Effect.gen(function* () {
      return yield* RemoteOrigin;
    })
  );
  const { runSync, runPromise } = test;
  return {
    service: remote,
    store: adaptStore(test),
    access: {
      acquire: (close: () => void) => {
        const lease = runSync(access.acquire(Effect.sync(close)));
        return () => runSync(lease.release);
      },
      get isOpen() {
        return runSync(access.isOpen);
      },
      end: () => runSync(access.end),
    },
    appOrigin: origin,
    get isEnabled() {
      return runSync(remote.isEnabled);
    },
    get tunnelHost() {
      return runSync(remote.tunnelHost);
    },
    snapshot: () => runSync(remote.snapshot),
    startPairing: () => runPromise(remote.startPairing),
    resolveHookUrl: (scheduleId: string, token: string) => runSync(remote.resolveHookUrl(scheduleId, token)),
    cancelPairing: () => runSync(remote.cancelPairing),
    enable: () => runPromise(remote.enable),
    disable: () => runPromise(remote.disable),
    remove: () => runPromise(remote.remove),
    createLink: () => runPromise(remote.createLink),
    removeLink: () => runPromise(remote.removeLink),
    handleClaims: (claimer: (taskId: string, guest: TaskGuest) => Promise<string | null>) =>
      runSync(
        remote.handleClaims((taskId, guest) =>
          Effect.tryPromise({
            try: () => claimer(taskId, guest),
            catch: (error) => new HandoffClaimFailed({ message: describeError(error) }),
          })
        )
      ),
    handleLeaves: (leaver: (userIds: string[]) => void) =>
      runSync(remote.handleLeaves((userIds) => Effect.sync(() => leaver(userIds)))),
    createHandoff: (taskId: string) => runPromise(remote.createHandoff(taskId)),
    removeHandoff: (taskId: string, guestId: string | null) =>
      runPromise(remote.removeHandoff(taskId, guestId)),
    grantTeammate: (userId: string, teamId: string) => runPromise(remote.grantTeammate(userId, teamId)),
    shareWithTeam: (teamId: string) => runPromise(remote.shareWithTeam(teamId)),
    syncSharedTeams: (teamIds: readonly string[]) => runPromise(remote.syncSharedTeams(teamIds)),
    unshareTeam: (teamId: string) => runPromise(remote.unshareTeam(teamId)),
    acceptRequest: (requestId: string) => runPromise(remote.acceptRequest(requestId)),
    declineRequest: (requestId: string) => runPromise(remote.declineRequest(requestId)),
    removeMember: (userId: string) => runPromise(remote.removeMember(userId)),
    publish: () => runPromise(remote.publish),
    subscribe: (listener: () => void) => {
      const scope = runSync(Scope.make());
      runSync(remote.observe(Effect.sync(listener)).pipe(Scope.provide(scope)));
      return () => runSync(Scope.close(scope, Exit.void));
    },
    start: () => runPromise(remote.start),
    requestHeartbeat: () => runPromise(remote.requestHeartbeat),
    stop: () => runPromise(remote.stop),
    verifyConnect: (token: string | null, channel: ConnectChannel) =>
      runPromise(remote.verifyConnect(token, channel)),
    spendConnect: (claim: ConnectClaim) => runSync(remote.spendConnect(claim)),
    openChannel: (
      peer: ChannelPeer,
      parts: {
        hub: ChannelHub;
        terminals?: ChannelTerminals | null;
        respond: (request: Request, guest: never, userId: string) => Promise<Response>;
      },
      userId: string
    ) =>
      adaptChannel(
        test,
        runSync(
          remote.openChannel(
            peer,
            {
              hub: parts.hub,
              terminals: parts.terminals ?? null,
              respond: (request, guest, user) =>
                Effect.promise(() => parts.respond(request, guest as never, user)),
            },
            userId
          )
        )
      ),
    closeChannel: (channel: { handle: RemoteChannelHandle }) => runSync(remote.closeChannel(channel.handle)),
    removeDevice: (publicKey: string) => runPromise(remote.removeDevice(publicKey)),
    isOwner: (userId: string | null) => runSync(remote.isOwner(userId)),
    hasAccess: (userId: string) => runSync(remote.hasAccess(userId)),
    resolveActor: (userId: string | null) => runSync(remote.resolveActor(userId)),
    resolveTeamScope: (userId: string, teamId: string) => runSync(remote.resolveTeamScope(userId, teamId)),
    listTeamScopes: (userId: string) => runSync(remote.listTeamScopes(userId)),
    resolveTeamGrant: (userId: string, teamId: string) => runPromise(remote.resolveTeamGrant(userId, teamId)),
    canForkTeamTask: (teamId: string) => runSync(remote.canForkTeamTask({ teamId })),
  };
}

export function adaptShares(test: RemoteTest) {
  const shares = test.get(Shares as never) as Shares['Service'];
  return {
    service: shares,
    acceptsShare: (shareId: string) => test.runSync(shares.acceptsShare(shareId)),
    openChannel: (peer: ChannelPeer, shareId: string) =>
      adaptShareChannel(test, test.runSync(shares.openChannel(peer, shareId))),
    closeChannel: (channel: { handle: ShareChannelHandle<string> }) =>
      test.runSync(shares.closeChannel(channel.handle)),
    link: (taskId: string, context: { key: string; attempt?: number }) =>
      test.runPromise(shares.link(taskId, { attempt: 1, ...context })),
    resolveLive: (taskId: string, scopes?: readonly ViewScope[]) =>
      test.runPromise(
        Effect.map(shares.resolveLive(taskId, scopes), (live) => ({
          view: live.view as ShareLiveView,
          files: live.files.map((file) => ({ ...file, read: () => test.runPromise(file.read) })),
        }))
      ),
  };
}

export function adaptTeams(test: RemoteTest) {
  const teams = test.get(Teams as never) as Teams['Service'];
  const { runSync, runPromise } = test;
  return {
    service: teams,
    create: (name: string) => runPromise(teams.create(name)),
    join: (url: string) => runPromise(teams.join(url)),
    resolveJoinUrl: (teamId: string) => runPromise(teams.resolveJoinUrl(teamId)),
    renewInvite: (teamId: string) => runPromise(teams.renewInvite(teamId)),
    turnOffInvite: (teamId: string) => runPromise(teams.turnOffInvite(teamId)),
    acceptRequest: (teamId: string, userId: string) => runPromise(teams.acceptRequest(teamId, userId)),
    declineRequest: (teamId: string, userId: string) => runPromise(teams.declineRequest(teamId, userId)),
    removeMember: (teamId: string, userId: string) => runPromise(teams.removeMember(teamId, userId)),
    updateScopes: (teamId: string, userId: string | null, scopes: AccessScopes | null) =>
      runPromise(teams.updateScopes(teamId, userId, scopes)),
    updateExtra: (teamId: string, userId: string, scopes: AccessScopes) =>
      runPromise(teams.updateExtra(teamId, userId, scopes)),
    listKeys: () => runSync(teams.listKeys),
    leave: (teamId: string) => runPromise(teams.leave(teamId)),
    remove: (teamId: string) => runPromise(teams.remove(teamId)),
    requestKey: (teamId: string) => runPromise(teams.requestKey(teamId)),
    acceptsViewer: () => runSync(teams.acceptsViewer),
    openChannel: (peer: ChannelPeer, userId: string) =>
      adaptShareChannel(test, runSync(teams.openChannel(peer, userId))),
    closeChannel: (channel: { handle: Parameters<Teams['Service']['closeChannel']>[0] }) =>
      runSync(teams.closeChannel(channel.handle)),
  };
}

export function adaptTeamFeeds(test: RemoteTest) {
  const feeds = test.get(TeamFeeds as never) as TeamFeeds['Service'];
  const { runSync } = test;
  const observe =
    (register: (listener: Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>) =>
    (listener: () => void) => {
      const scope = runSync(Scope.make());
      runSync(register(Effect.sync(listener)).pipe(Scope.provide(scope)));
      return () => runSync(Scope.close(scope, Exit.void));
    };
  return {
    service: feeds,
    start: () => test.runPromise(feeds.start),
    stop: () => test.runPromise(feeds.stop),
    sync: () => test.runPromise(feeds.sync),
    subscribe: observe(feeds.observe),
    subscribeHeld: observe(feeds.observeHeld),
    listHeld: (teamId: string) => runSync(feeds.listHeld(teamId)),
    snapshot: () => runSync(feeds.snapshot),
    listGrants: () => runSync(feeds.listGrants),
    listTasks: (filter: TeamTaskFilter = {}) => runSync(feeds.listTasks(filter)),
    openRelay: async (peer: ChannelPeer, target: TeamViewTarget) => {
      const relay = await test.runPromise(feeds.openRelay(peer, target));
      return { close: () => runSync(relay.close) };
    },
    answerKeyRequest: (teamId: string, instanceId: string, approve: boolean) =>
      test.runPromise(feeds.answerKeyRequest(teamId, instanceId, approve)),
    openStream: (target: TeamStreamTarget, handlers: TeamStreamHandlers) => {
      const fiber = Effect.runForkWith(test.context)(feeds.openStream(target, handlers));
      return () => {
        runSync(Fiber.interrupt(fiber));
      };
    },
  };
}

export function adaptPreviews(test: RemoteTest) {
  const previews = test.get(Previews as never) as Previews['Service'];
  return {
    service: previews,
    link: (taskId: string, serviceId: string, context: { key: string; attempt?: number }) =>
      test.runPromise(previews.link(taskId, serviceId, { attempt: 1, ...context })),
    answer: (request: Request, url: URL) => test.runPromise(previews.answer(request, url)),
    openSocket: (...args: Parameters<Previews['Service']['openSocket']>) =>
      test.runSync(previews.openSocket(...args)),
  };
}
