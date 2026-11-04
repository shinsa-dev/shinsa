import {
  type ActorScope,
  type ChatEntry,
  isTaskInScope,
  listScopedTasks,
  type ConnectChannel,
  LOCAL_ONLY_MESSAGE,
  OWNER_ONLY_MESSAGE,
  REMOTE_CONNECT_PARAM,
  SCOPE_MESSAGES,
  SHARE_CHANNEL_PARAM,
  splitMessageAttachments,
  TEAM_SCOPE_MESSAGES,
} from '@shinsa/core';
import {
  ConnectRefused,
  GuestRoute,
  InspectReadOnly,
  LocalOnly,
  LocalOnlyRoute,
  NotMachineOwner,
  OwnerOnlyRoute,
  RequestForbidden,
  RouteNotFound,
  ROUTE_NOT_FOUND_MESSAGE,
  ScopeRefused,
} from '@shinsa/core/engine-api/schema';
import { Context, Effect, Layer, Option } from 'effect';
import { Transcripts } from '../../agents/transcripts/service.ts';
import { EngineConfig } from '../../config/service.ts';
import { Extensions } from '../../extensions/registry/service.ts';
import { SIGN_IN_CALLBACK_PATH } from '../../extensions/sign-in.ts';
import type { RequestSourceShape } from '../../http/schema.ts';
import { INSPECT_MESSAGE } from '../../instance/index.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { ATTACHMENT_ROUTE } from '../../store/attachments/index.ts';
import { EVIDENCE_ROUTE } from '../../store/evidence/index.ts';
import { RemoteOrigin } from '../client/schema.ts';
import { Remote } from '../machine/service.ts';
import { Previews } from '../previews/service.ts';
import { Shares } from '../shares/service.ts';
import { RemoteStore } from '../store/service.ts';
import { Teams } from '../teams/service.ts';
import {
  CONNECT_REFUSED_MESSAGE,
  type EndpointRefusal,
  type GateRequest,
  GUEST_HEALTH_PATH,
  GUEST_READ_METHODS,
  GUEST_TASK_READS,
  type RequestRefusal,
  TUNNEL_HEADER,
  TUNNEL_HTTP_ROUTES,
  TUNNEL_ONLY_ROUTES,
  TUNNEL_ROUTES,
  type TunnelRoute,
  type TunnelUpgrade,
  type UpgradeRefusal,
  WRITING_ROUTES,
} from './schema.ts';

export class TunnelGate extends Context.Service<
  TunnelGate,
  {
    isTunnel(request: Request): boolean;
    resolveRoute(request: GateRequest): TunnelRoute | null;
    admitRequest(request: Request, url: URL, source: RequestSourceShape): Effect.Effect<void, RequestRefusal>;
    admitEndpoint(
      annotations: Context.Context<never>,
      request: GateRequest,
      source: RequestSourceShape
    ): Effect.Effect<void, EndpointRefusal>;
    admitUpgrade(request: Request, url: URL): Effect.Effect<TunnelUpgrade, UpgradeRefusal>;
  }
>()('shinsa/engine/remote/gate/TunnelGate') {
  static readonly layer = Layer.effect(
    TunnelGate,
    Effect.gen(function* () {
      const config = yield* EngineConfig;
      const remote = Option.getOrUndefined(yield* Effect.serviceOption(Remote));
      const remoteStore = Option.getOrUndefined(yield* Effect.serviceOption(RemoteStore));
      const remoteOrigin = yield* RemoteOrigin;
      const shares = Option.getOrUndefined(yield* Effect.serviceOption(Shares));
      const teams = Option.getOrUndefined(yield* Effect.serviceOption(Teams));
      const previews = Option.getOrUndefined(yield* Effect.serviceOption(Previews));
      const extensions = Option.getOrUndefined(yield* Effect.serviceOption(Extensions));
      const engine = yield* EngineCore;
      const transcripts = yield* Transcripts;
      const runSync = Effect.runSyncWith(yield* Effect.context<never>());
      const isEnabled = remote ? remote.isEnabled : Effect.succeed(false);
      const notFound = () => new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });

      const readHostname = (request: Request) =>
        (request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();

      const isTunnel = (request: Request) => {
        if (!remote) return false;
        if (request.headers.has(TUNNEL_HEADER)) return true;
        const host = runSync(remote.tunnelHost);
        return host !== null && readHostname(request) === host.toLowerCase();
      };

      const resolveRoute = ({ method, pathname }: GateRequest) => {
        const entry = TUNNEL_ROUTES.find(
          (candidate) =>
            (candidate.prefix ? pathname.startsWith(candidate.path) : pathname === candidate.path) &&
            (candidate.methods === null || candidate.methods.has(method))
        );
        return entry?.route ?? null;
      };

      const assertWritable = (method: string) =>
        config.inspect && !GUEST_READ_METHODS.has(method)
          ? Effect.fail(new InspectReadOnly({ message: INSPECT_MESSAGE }))
          : Effect.void;

      const listEntryFiles = (entry: ChatEntry) => {
        if (entry.type === 'tool_result') return entry.images;
        if (entry.type === 'user') return entry.attachments.map((attachment) => attachment.url);
        return [];
      };

      const isTaskFile = Effect.fn('TunnelGate.isTaskFile')(function* (taskId: string, path: string) {
        const state = yield* engine.state;
        if (path.startsWith(`${EVIDENCE_ROUTE}${taskId}/`)) return true;
        if (Object.values(state.evidence).some((entry) => entry.taskId === taskId && entry.uri === path))
          return true;
        const task = state.tasks[taskId];
        const texts = [task?.request ?? '', ...(task?.inbox ?? []).map((message) => message.text)];
        const attached = texts.flatMap((text) => splitMessageAttachments(text).attachments);
        if (attached.some((attachment) => attachment.url === path)) return true;
        for (const run of Object.values(state.runs)) {
          if (run.taskId !== taskId) continue;
          const entries = yield* transcripts.listEntries(run.id);
          if (entries.some((entry) => listEntryFiles(entry).includes(path))) return true;
        }
        return false;
      });

      const isGuestRoute = Effect.fn('TunnelGate.isGuestRoute')(function* (
        scope: ActorScope,
        { method, pathname }: GateRequest
      ) {
        if (!GUEST_READ_METHODS.has(method)) return false;
        if (pathname === GUEST_HEALTH_PATH) return true;
        const state = yield* engine.state;
        const task = GUEST_TASK_READS.exec(pathname);
        if (task) return isTaskInScope(state, scope, decodeURIComponent(task[1] ?? ''));
        if (!(pathname.startsWith(EVIDENCE_ROUTE) || pathname.startsWith(ATTACHMENT_ROUTE))) return false;
        for (const entry of listScopedTasks(state, scope)) {
          if (yield* isTaskFile(entry.id, pathname)) return true;
        }
        return false;
      });

      const resolveScopeMessage = (scope: ActorScope, pathname: string) => {
        if (scope.kind === 'task') return SCOPE_MESSAGES.task;
        return GUEST_TASK_READS.test(pathname) ? TEAM_SCOPE_MESSAGES.task : TEAM_SCOPE_MESSAGES.command;
      };

      const refuseScope = (scope: ActorScope, pathname: string) =>
        new ScopeRefused({ message: resolveScopeMessage(scope, pathname) });

      const isOwner = Effect.fn('TunnelGate.isOwner')(function* (userId: string | null) {
        if (userId === null || !remoteStore) return false;
        return (yield* remoteStore.file).access?.owner.id === userId;
      });

      const admitChannelRequest = (url: URL, source: RequestSourceShape) => {
        if (!url.pathname.startsWith('/api/')) return Effect.fail(notFound());
        if (extensions === undefined || url.pathname !== SIGN_IN_CALLBACK_PATH) return Effect.void;
        if (source.guest) return Effect.fail(refuseScope(source.guest.scope, url.pathname));
        return Effect.fail(new LocalOnly({ message: LOCAL_ONLY_MESSAGE }));
      };

      const admitTunnelRequest = Effect.fn('TunnelGate.admitTunnelRequest')(function* (
        request: Request,
        url: URL
      ) {
        const route = (yield* isEnabled)
          ? resolveRoute({ method: request.method, pathname: url.pathname })
          : null;
        if (route === null || !TUNNEL_HTTP_ROUTES.has(route)) return yield* notFound();
        if (WRITING_ROUTES.has(route)) yield* assertWritable('POST');
      });

      const admitLocalRequest = (request: Request, url: URL) => {
        const route = resolveRoute({ method: request.method, pathname: url.pathname });
        return route !== null && TUNNEL_ONLY_ROUTES.has(route) ? Effect.fail(notFound()) : Effect.void;
      };

      const admitRequest = (request: Request, url: URL, source: RequestSourceShape) => {
        if (source.via === 'channel') return admitChannelRequest(url, source);
        if (source.via === 'tunnel') return admitTunnelRequest(request, url);
        return admitLocalRequest(request, url);
      };

      const admitEndpoint = Effect.fn('TunnelGate.admitEndpoint')(function* (
        annotations: Context.Context<never>,
        request: GateRequest,
        source: RequestSourceShape
      ) {
        if (source.via !== 'channel') return;
        const access = Context.get(annotations, GuestRoute);
        const admitsGuest =
          access === 'any' ||
          (access !== 'none' && source.guest !== null && (yield* isGuestRoute(source.guest.scope, request)));
        if (source.guest && !admitsGuest) return yield* refuseScope(source.guest.scope, request.pathname);
        if (Context.get(annotations, LocalOnlyRoute))
          return yield* new LocalOnly({ message: LOCAL_ONLY_MESSAGE });
        if (Context.get(annotations, OwnerOnlyRoute) && !(yield* isOwner(source.userId)))
          return yield* new NotMachineOwner({ message: OWNER_ONLY_MESSAGE });
        yield* assertWritable(request.method);
      });

      const assertAppOrigin = (request: Request) => {
        if (remote && remoteOrigin && request.headers.get('origin') === remoteOrigin) return Effect.void;
        const host = remote && remoteOrigin ? new URL(remoteOrigin).host : '';
        return Effect.fail(new RequestForbidden({ message: `The remote channel only opens from ${host}.` }));
      };

      const isSocketUpgrade = (request: Request) =>
        request.headers.get('upgrade')?.toLowerCase() === 'websocket';

      const findConnectUser = Effect.fn('TunnelGate.findConnectUser')(function* (
        request: Request,
        url: URL,
        channel: ConnectChannel
      ) {
        const token = url.searchParams.get(REMOTE_CONNECT_PARAM);
        const claim = remote ? yield* remote.verifyConnect(token, channel) : null;
        if (!(remote && claim)) return yield* new ConnectRefused({ message: CONNECT_REFUSED_MESSAGE });
        if (!isSocketUpgrade(request)) return yield* notFound();
        if (!(yield* remote.spendConnect(claim)))
          return yield* new ConnectRefused({ message: CONNECT_REFUSED_MESSAGE });
        return claim.userId;
      });

      const admitShare = Effect.fn('TunnelGate.admitShare')(function* (
        request: Request,
        url: URL
      ): Effect.fn.Return<TunnelUpgrade, UpgradeRefusal> {
        if (!shares) return yield* notFound();
        yield* assertAppOrigin(request);
        const shareId = url.searchParams.get(SHARE_CHANNEL_PARAM) ?? '';
        if (!((yield* shares.acceptsShare(shareId)) && isSocketUpgrade(request))) return yield* notFound();
        return { route: 'share', shareId };
      });

      const admitUpgrade = Effect.fn('TunnelGate.admitUpgrade')(function* (
        request: Request,
        url: URL
      ): Effect.fn.Return<TunnelUpgrade, UpgradeRefusal> {
        const route = (yield* isEnabled)
          ? resolveRoute({ method: request.method, pathname: url.pathname })
          : null;
        if (route === null) return yield* notFound();
        if (TUNNEL_HTTP_ROUTES.has(route)) return { route: 'http' };
        if (route === 'preview') {
          if (!previews) return yield* notFound();
          return { route: 'preview' };
        }
        if (route === 'share') return yield* admitShare(request, url);
        if (route === 'team') {
          if (!(teams && (yield* teams.acceptsViewer))) return yield* notFound();
          yield* assertAppOrigin(request);
          return { route: 'team', userId: yield* findConnectUser(request, url, 'team') };
        }
        yield* assertAppOrigin(request);
        return { route: 'channel', userId: yield* findConnectUser(request, url, 'remote') };
      });

      return TunnelGate.of({ isTunnel, resolveRoute, admitRequest, admitEndpoint, admitUpgrade });
    })
  );
}
