import {
  type ChatEntry,
  type ConnectChannel,
  LOCAL_ONLY_MESSAGE,
  REMOTE_CONNECT_PARAM,
  SCOPE_MESSAGES,
  SHARE_CHANNEL_PARAM,
  splitMessageAttachments,
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
import { Context, Effect, Layer } from 'effect';
import type { RequestSourceShape } from '../../http/schema.ts';
import { HttpServices } from '../../http/services/service.ts';
import { INSPECT_MESSAGE } from '../../instance/index.ts';
import { ATTACHMENT_ROUTE } from '../../store/attachments/index.ts';
import { EVIDENCE_ROUTE } from '../../store/evidence/index.ts';
import {
  CONNECT_REFUSED_MESSAGE,
  type EndpointRefusal,
  type GateRequest,
  GUEST_HEALTH_PATH,
  GUEST_READ_METHODS,
  GUEST_TASK_READS,
  OWNER_ONLY_MESSAGE,
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
      const { config, remote, shares, teams, previews, extensions, engine, transcripts } =
        yield* HttpServices;
      const notFound = () => new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });

      const readHostname = (request: Request) =>
        (request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();

      const isTunnel = (request: Request) => {
        if (!remote) return false;
        if (request.headers.has(TUNNEL_HEADER)) return true;
        const host = remote.tunnelHost;
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

      const isTaskFile = (taskId: string, path: string) => {
        const { state } = engine;
        if (path.startsWith(`${EVIDENCE_ROUTE}${taskId}/`)) return true;
        if (Object.values(state.evidence).some((entry) => entry.taskId === taskId && entry.uri === path))
          return true;
        const task = state.tasks[taskId];
        const texts = [task?.request ?? '', ...(task?.inbox ?? []).map((message) => message.text)];
        const attached = texts.flatMap((text) => splitMessageAttachments(text).attachments);
        if (attached.some((attachment) => attachment.url === path)) return true;
        return Object.values(state.runs)
          .filter((run) => run.taskId === taskId)
          .some((run) =>
            transcripts.listEntries(run.id).some((entry) => listEntryFiles(entry).includes(path))
          );
      };

      const isGuestRoute = (taskId: string, { method, pathname }: GateRequest) => {
        if (!GUEST_READ_METHODS.has(method)) return false;
        if (pathname === GUEST_HEALTH_PATH) return true;
        const task = GUEST_TASK_READS.exec(pathname);
        if (task) return decodeURIComponent(task[1] ?? '') === taskId;
        if (!(pathname.startsWith(EVIDENCE_ROUTE) || pathname.startsWith(ATTACHMENT_ROUTE))) return false;
        return isTaskFile(taskId, pathname);
      };

      const isOwner = (userId: string | null) =>
        userId !== null && remote?.store.file.access?.owner.id === userId;

      const admitChannelRequest = (url: URL, source: RequestSourceShape) => {
        if (!url.pathname.startsWith('/api/')) return Effect.fail(notFound());
        if (!extensions?.isCallback(url.pathname)) return Effect.void;
        if (source.guest) return Effect.fail(new ScopeRefused({ message: SCOPE_MESSAGES.task }));
        return Effect.fail(new LocalOnly({ message: LOCAL_ONLY_MESSAGE }));
      };

      const admitTunnelRequest = (request: Request, url: URL) => {
        const route = remote?.isEnabled
          ? resolveRoute({ method: request.method, pathname: url.pathname })
          : null;
        if (route === null || !TUNNEL_HTTP_ROUTES.has(route)) return Effect.fail(notFound());
        return WRITING_ROUTES.has(route) ? assertWritable('POST') : Effect.void;
      };

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
          (access !== 'none' && source.guest !== null && isGuestRoute(source.guest.taskId, request));
        if (source.guest && !admitsGuest) return yield* new ScopeRefused({ message: SCOPE_MESSAGES.task });
        if (Context.get(annotations, LocalOnlyRoute))
          return yield* new LocalOnly({ message: LOCAL_ONLY_MESSAGE });
        if (Context.get(annotations, OwnerOnlyRoute) && !isOwner(source.userId))
          return yield* new NotMachineOwner({ message: OWNER_ONLY_MESSAGE });
        yield* assertWritable(request.method);
      });

      const assertAppOrigin = (request: Request) => {
        if (remote && request.headers.get('origin') === remote.appOrigin) return Effect.void;
        const host = remote ? new URL(remote.appOrigin).host : '';
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
        const claim = remote ? yield* Effect.promise(() => remote.verifyConnect(token, channel)) : null;
        if (!(remote && claim)) return yield* new ConnectRefused({ message: CONNECT_REFUSED_MESSAGE });
        if (!isSocketUpgrade(request)) return yield* notFound();
        if (!remote.spendConnect(claim))
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
        if (!(shares.acceptsShare(shareId) && isSocketUpgrade(request))) return yield* notFound();
        return { route: 'share', shareId };
      });

      const admitUpgrade = Effect.fn('TunnelGate.admitUpgrade')(function* (
        request: Request,
        url: URL
      ): Effect.fn.Return<TunnelUpgrade, UpgradeRefusal> {
        const route = remote?.isEnabled
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
          if (!teams?.acceptsViewer()) return yield* notFound();
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
