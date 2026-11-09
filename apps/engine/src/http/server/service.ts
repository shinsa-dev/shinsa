import {
  parseTeamRelayPath,
  parseTeamRelaySocketPath,
  parseTeamViewTarget,
  TEAM_VIEW_PATH,
  type ScopedActor,
} from '@shinsa/core';
import {
  ConnectRefused,
  ENGINE_BODY_LIMIT_BYTES,
  LocalOnly,
  RequestForbidden,
} from '@shinsa/core/engine-api/schema';
import { Context, Effect, Layer, Option, Predicate } from 'effect';
import { Accounts } from '../../accounts/roster/service.ts';
import { Transcripts } from '../../agents/transcripts/service.ts';
import { isLoopbackAddress, readBrowserKey } from '../../browser/proxy/endpoint.ts';
import { BROWSER_UNAVAILABLE, NOT_LOCAL_MESSAGE } from '../../browser/proxy/schema.ts';
import { BrowserProxy } from '../../browser/proxy/service.ts';
import { EngineConfig } from '../../config/service.ts';
import { createServerInstance } from '../../instance/index.ts';
import type { ChannelPeer } from '../../remote/channel/schema.ts';
import { FleetRelay } from '../../remote/fleet-relay/service.ts';
import { TunnelGate } from '../../remote/gate/service.ts';
import { Remote } from '../../remote/machine/service.ts';
import { Presence } from '../../remote/presence/service.ts';
import { Previews } from '../../remote/previews/service.ts';
import { POLICY_VIOLATION } from '../../remote/schema.ts';
import { Shares } from '../../remote/shares/service.ts';
import { TeamFeeds } from '../../remote/team-feeds/service.ts';
import { Teams } from '../../remote/teams/service.ts';
import { ResourceMonitor } from '../../resources/monitor/service.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { ATTACHMENT_REQUEST_LIMIT_BYTES } from '../../store/index.ts';
import { createTerminalSockets, readTerminalSocketId } from '../../terminals/index.ts';
import { Terminals } from '../../terminals/service.ts';
import { CommandRouter } from '../../triage/router/service.ts';
import { type EngineHandlerServices, makeEngineHandler } from '../app.ts';
import { resolveAllowedHosts, resolveRefusal, resolveUpgradeRefusal } from '../guard.ts';
import { PORT_TAKEN, PortInUse, RequestSource, ServedInstance } from '../schema.ts';
import { makeSocketHub } from '../socket.ts';
import {
  createSocketHandlers,
  makeBrowserSockets,
  makeRemoteSockets,
  type PreviewSocketData,
  type PreviewSocketHandlers,
  respondNotFound,
  respondRefusal,
  respondUpgradeRefusal,
  type ServerSocketData,
  SOCKET_BACKPRESSURE_LIMIT_BYTES,
} from './sockets.ts';
import { resolveServerUrl } from './url.ts';

export class EngineServer extends Context.Service<
  EngineServer,
  { readonly url: string; readonly port: number }
>()('shinsa/engine/http/server/EngineServer') {
  static readonly layer = Layer.effect(
    EngineServer,
    Effect.gen(function* () {
      const config = yield* EngineConfig;
      const engine = yield* EngineCore;
      const transcripts = yield* Transcripts;
      const instance = (yield* ServedInstance) ?? createServerInstance();
      const accounts = Option.getOrUndefined(yield* Effect.serviceOption(Accounts));
      const router = Option.getOrNull(yield* Effect.serviceOption(CommandRouter));
      const terminals = Option.getOrUndefined(yield* Effect.serviceOption(Terminals));
      const remote = Option.getOrUndefined(yield* Effect.serviceOption(Remote));
      const teamFeeds = Option.getOrUndefined(yield* Effect.serviceOption(TeamFeeds));
      const fleetRelay = Option.getOrUndefined(yield* Effect.serviceOption(FleetRelay));
      const resources = Option.getOrUndefined(yield* Effect.serviceOption(ResourceMonitor));
      const shares = Option.getOrUndefined(yield* Effect.serviceOption(Shares));
      const teams = Option.getOrUndefined(yield* Effect.serviceOption(Teams));
      const previews = Option.getOrUndefined(yield* Effect.serviceOption(Previews));
      const presence = Option.getOrUndefined(yield* Effect.serviceOption(Presence));
      const browser = Option.getOrUndefined(yield* Effect.serviceOption(BrowserProxy));
      const allowedHosts = resolveAllowedHosts(config.allowedHosts);
      const handle = (request: Request, context: Context.Context<never>): Promise<Response> =>
        (web.handler as (request: Request, context: Context.Context<never>) => Promise<Response>)(
          request,
          context
        );
      const services = yield* Effect.context<EngineHandlerServices>();
      const runSync = Effect.runSyncWith(services);
      const runFork = Effect.runForkWith(services);
      const hub = yield* makeSocketHub({
        engine,
        transcripts,
        accounts,
        router,
        terminals,
        remote,
        teamFeeds,
        version: instance.version,
        resources,
        teams: remote,
        presence,
      });
      const terminalSockets = terminals ? yield* createTerminalSockets(terminals) : null;
      const gate = yield* TunnelGate.pipe(Effect.provide(TunnelGate.layer));

      function respondInsideChannel(request: Request, guest: ScopedActor | null, userId: string) {
        return Effect.promise(() =>
          handle(request, Context.make(RequestSource, { via: 'channel', guest, userId }))
        );
      }

      function upgrade(request: Request, bunServer: Bun.Server<ServerSocketData>, data: ServerSocketData) {
        const upgradeRefusal = resolveUpgradeRefusal(request);
        if (upgradeRefusal) return respondRefusal(RequestForbidden, upgradeRefusal);
        return upgradeAdmitted(request, bunServer, data);
      }

      function upgradeAdmitted(
        request: Request,
        bunServer: Bun.Server<ServerSocketData>,
        data: ServerSocketData,
        headers?: Record<string, string>
      ) {
        if (bunServer.upgrade(request, { data, ...(headers ? { headers } : {}) })) return undefined;
        return new Response('Upgrade failed', { status: 400 });
      }

      const remoteSockets = remote
        ? yield* makeRemoteSockets(remote, {
            hub,
            terminals: terminals ?? null,
            respond: respondInsideChannel,
          })
        : null;

      const previewSockets: PreviewSocketHandlers | null = previews
        ? {
            open: (socket) => {
              socket.data.relay = runSync(
                previews.openSocket(
                  {
                    send: (data) => socket.send(data),
                    close: (code, reason) => socket.close(code, reason),
                  },
                  socket.data.upgrade
                )
              );
            },
            close: (socket) => {
              socket.data.relay?.close();
            },
            message: (socket, raw) => {
              socket.data.relay?.send(typeof raw === 'string' ? raw : new Uint8Array(raw));
            },
          }
        : null;

      const browserSockets = browser ? yield* makeBrowserSockets(browser) : null;

      function respondBrowserSocket(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
        const key = readBrowserKey(url.pathname);
        if (key === null) return null;
        if (!browser) return respondNotFound();
        if (!isLoopbackAddress(bunServer.requestIP(request)?.address)) {
          return respondRefusal(LocalOnly, NOT_LOCAL_MESSAGE);
        }
        const refusal = resolveRefusal(request, allowedHosts);
        if (refusal) return respondRefusal(RequestForbidden, refusal);
        return run(
          browser.admit(key).pipe(
            Effect.matchEffect({
              onFailure: (failure) =>
                Effect.succeed(
                  respondRefusal(
                    failure._tag === 'BrowserKeyRefused' ? ConnectRefused : BROWSER_UNAVAILABLE,
                    failure.message
                  )
                ),
              onSuccess: (admission) => {
                const refused = upgradeAdmitted(request, bunServer, {
                  kind: 'browser',
                  admission,
                  relay: null,
                });
                return refused ? Effect.as(browser.dismiss(admission), refused) : Effect.succeed(refused);
              },
            })
          )
        );
      }

      const respondPreview = Effect.fn('serveHttp.respondPreview')(function* (
        request: Request,
        url: URL,
        bunServer: Bun.Server<ServerSocketData>
      ) {
        if (!previews) return respondNotFound();
        const answer = yield* previews.answer(request, url);
        if (answer.kind === 'response') return answer.response;
        const [protocol] = answer.upgrade.protocols;
        const headers = protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined;
        const data: PreviewSocketData = { kind: 'preview', upgrade: answer.upgrade, relay: null };
        return upgradeAdmitted(request, bunServer, data, headers);
      });

      function openShareChannel(request: Request, bunServer: Bun.Server<ServerSocketData>, shareId: string) {
        if (!shares) return respondNotFound();
        const open = (peer: ChannelPeer) => {
          const channel = runSync(shares.openChannel(peer, shareId));
          return {
            receive: (raw: string | Buffer) => runFork(channel.receive(raw)),
            close: () => runFork(shares.closeChannel(channel)),
          };
        };
        return upgradeAdmitted(request, bunServer, { kind: 'live', open, channel: null });
      }

      function openTeamChannel(request: Request, bunServer: Bun.Server<ServerSocketData>, userId: string) {
        if (!teams) return respondNotFound();
        const open = (peer: ChannelPeer) => {
          const channel = runSync(teams.openChannel(peer, userId));
          return {
            receive: (raw: string | Buffer) => runFork(channel.receive(raw)),
            close: () => runFork(teams.closeChannel(channel)),
          };
        };
        return upgradeAdmitted(request, bunServer, { kind: 'live', open, channel: null });
      }

      function openRemoteChannel(request: Request, bunServer: Bun.Server<ServerSocketData>, userId: string) {
        return upgradeAdmitted(request, bunServer, { kind: 'remote', channel: null, userId });
      }

      function respondTeamView(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
        const target = parseTeamViewTarget(url);
        if (!(teamFeeds && target)) return respondNotFound();
        const open = (peer: ChannelPeer) => {
          const relay = runSync(teamFeeds.openRelay(peer, target));
          return {
            receive: () => {
              runFork(relay.close);
              peer.close(POLICY_VIOLATION, 'A team view only listens.');
            },
            close: () => runFork(relay.close),
          };
        };
        return upgrade(request, bunServer, { kind: 'live', open, channel: null });
      }

      function respondRelaySocket(
        request: Request,
        bunServer: Bun.Server<ServerSocketData>,
        instanceId: string
      ) {
        if (!fleetRelay) return respondNotFound();
        const open = (peer: ChannelPeer) => {
          const socket = runSync(fleetRelay.openSocket(instanceId, peer));
          return {
            receive: (raw: string | Buffer) =>
              runFork(socket.receive(typeof raw === 'string' ? raw : new Uint8Array(raw))),
            close: () => runFork(socket.close),
          };
        };
        return upgrade(request, bunServer, { kind: 'live', open, channel: null });
      }

      function respondLocalRelay(request: Request, url: URL) {
        const target = parseTeamRelayPath(url.pathname);
        if (!target) return null;
        const refusal = resolveRefusal(request, allowedHosts);
        if (refusal) return respondRefusal(RequestForbidden, refusal);
        if (!fleetRelay) return respondNotFound();
        return run(fleetRelay.request(target.instanceId, target.path, request));
      }

      const respondTunnelSocket = Effect.fn('serveHttp.respondTunnelSocket')(function* (
        request: Request,
        url: URL,
        bunServer: Bun.Server<ServerSocketData>
      ) {
        const admitted = yield* gate.admitUpgrade(request, url).pipe(Effect.result);
        if (admitted._tag === 'Failure') return respondUpgradeRefusal(admitted.failure);
        const admission = admitted.success;
        if (admission.route === 'share') return openShareChannel(request, bunServer, admission.shareId);
        if (admission.route === 'team') return openTeamChannel(request, bunServer, admission.userId);
        if (admission.route === 'channel') return openRemoteChannel(request, bunServer, admission.userId);
        if (admission.route === 'preview') return yield* respondPreview(request, url, bunServer);
        return yield* Effect.promise(() => handle(request, Context.empty()));
      });

      const run = Effect.runPromiseWith(services);

      function respondLocalSocket(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
        const isPage = url.pathname === '/ws';
        const isTeamView = url.pathname === TEAM_VIEW_PATH;
        const relayId = parseTeamRelaySocketPath(url.pathname);
        const terminalId = terminalSockets ? readTerminalSocketId(url.pathname) : null;
        if (!(isPage || isTeamView || relayId || terminalId)) return null;
        const refusal = resolveRefusal(request, allowedHosts);
        if (refusal) return respondRefusal(RequestForbidden, refusal);
        if (isTeamView) return respondTeamView(request, url, bunServer);
        if (relayId) return respondRelaySocket(request, bunServer, relayId);
        if (terminalId) return upgrade(request, bunServer, { kind: 'terminal', terminalId, viewer: null });
        return upgrade(request, bunServer, {
          kind: 'hub',
          transcripts: new Map(),
          surface: null,
          origin: 'local',
          guest: null,
          userId: null,
        });
      }

      const { server, web } = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const listening = Bun.serve<ServerSocketData>({
            port: config.port,
            hostname: config.hostname,
            maxRequestBodySize: ATTACHMENT_REQUEST_LIMIT_BYTES,
            fetch(request, bunServer) {
              const url = new URL(request.url);
              if (gate.isTunnel(request)) return run(respondTunnelSocket(request, url, bunServer));
              return (
                respondBrowserSocket(request, url, bunServer) ??
                respondLocalSocket(request, url, bunServer) ??
                respondLocalRelay(request, url) ??
                handle(request, Context.empty())
              );
            },
            websocket: {
              ...createSocketHandlers(hub, terminalSockets, remoteSockets, previewSockets, browserSockets),
              maxPayloadLength: ENGINE_BODY_LIMIT_BYTES,
              backpressureLimit: SOCKET_BACKPRESSURE_LIMIT_BYTES,
            },
          });
          return { server: listening, web: makeEngineHandler(services) };
        }).pipe(
          Effect.catchDefect((defect) =>
            Predicate.hasProperty(defect, 'code') && defect.code === PORT_TAKEN
              ? Effect.fail(
                  new PortInUse({
                    message: `Failed to start server. Is port ${config.port} in use? Quit the program on it, or set another \`port\` in ${config.configPath}.`,
                  })
                )
              : Effect.die(defect)
          )
        ),
        (opened) =>
          Effect.promise(() => opened.server.stop(true)).pipe(
            Effect.andThen(Effect.promise(() => opened.web.dispose()))
          )
      );
      const url = resolveServerUrl(config.hostname, server.port ?? config.port);
      yield* Effect.logInfo('[Server] Listening').pipe(Effect.annotateLogs({ url }));
      return EngineServer.of({ url, port: server.port ?? config.port });
    })
  );
}
