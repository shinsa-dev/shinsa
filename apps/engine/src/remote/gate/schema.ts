import {
  PREVIEW_TUNNEL_PREFIX,
  REMOTE_CHANNEL_PATH,
  REMOTE_ENGINE_HOOK_PREFIX,
  SHARE_CHANNEL_PATH,
  SLACK_ENGINE_EVENTS_PATH,
  SLACK_ENGINE_INTERACTIONS_PATH,
  SLACK_ENGINE_MESSAGES_PATH,
  TEAM_CHANNEL_PATH,
} from '@shinsa/core';
import type {
  ConnectRefused,
  InspectReadOnly,
  LocalOnly,
  NotMachineOwner,
  RequestForbidden,
  RouteNotFound,
  ScopeRefused,
} from '@shinsa/core/engine-api/schema';
import { Schema } from 'effect';
import { TUNNEL_HEALTH_PATH } from '../../http/routes/tunnel/schema.ts';

export const TunnelRoute = Schema.Literals([
  'health',
  'hook',
  'channel',
  'share',
  'team',
  'preview',
  'slack',
]);

export type TunnelRoute = typeof TunnelRoute.Type;

export interface TunnelRouteEntry {
  readonly route: TunnelRoute;
  readonly methods: ReadonlySet<string> | null;
  readonly path: string;
  readonly prefix: boolean;
}

const GET_ONLY: ReadonlySet<string> = new Set(['GET']);

const POST_ONLY: ReadonlySet<string> = new Set(['POST']);

export const TUNNEL_ROUTES: readonly TunnelRouteEntry[] = [
  { route: 'health', methods: GET_ONLY, path: TUNNEL_HEALTH_PATH, prefix: false },
  { route: 'hook', methods: null, path: REMOTE_ENGINE_HOOK_PREFIX, prefix: true },
  { route: 'channel', methods: GET_ONLY, path: REMOTE_CHANNEL_PATH, prefix: false },
  { route: 'share', methods: GET_ONLY, path: SHARE_CHANNEL_PATH, prefix: false },
  { route: 'team', methods: GET_ONLY, path: TEAM_CHANNEL_PATH, prefix: false },
  { route: 'preview', methods: null, path: PREVIEW_TUNNEL_PREFIX, prefix: true },
  { route: 'slack', methods: POST_ONLY, path: SLACK_ENGINE_EVENTS_PATH, prefix: false },
  { route: 'slack', methods: POST_ONLY, path: SLACK_ENGINE_INTERACTIONS_PATH, prefix: false },
  { route: 'slack', methods: POST_ONLY, path: SLACK_ENGINE_MESSAGES_PATH, prefix: false },
];

export const TUNNEL_HTTP_ROUTES: ReadonlySet<TunnelRoute> = new Set(['health', 'hook', 'slack']);

export const TUNNEL_ONLY_ROUTES: ReadonlySet<TunnelRoute> = new Set(['health', 'slack']);

export const WRITING_ROUTES: ReadonlySet<TunnelRoute> = new Set(['hook', 'slack']);

export const TUNNEL_HEADER = 'cf-connecting-ip';

export const GUEST_TASK_READS = /^\/api\/tasks\/([^/]+)(?:\/(?:blob|chat|diff|paths|raw|refs|search|tree))?$/;

export const GUEST_READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

export const GUEST_HEALTH_PATH = '/api/health';

export const CONNECT_REFUSED_MESSAGE = 'The connect token is missing, wrong or expired.';

export interface GateRequest {
  readonly method: string;
  readonly pathname: string;
}

export type TunnelUpgrade =
  | { readonly route: 'http' }
  | { readonly route: 'preview' }
  | { readonly route: 'share'; readonly shareId: string }
  | { readonly route: 'team'; readonly userId: string }
  | { readonly route: 'channel'; readonly userId: string };

export type UpgradeRefusal = RouteNotFound | RequestForbidden | ConnectRefused;

export type RequestRefusal = RouteNotFound | InspectReadOnly | ScopeRefused | LocalOnly;

export type EndpointRefusal = ScopeRefused | LocalOnly | NotMachineOwner | InspectReadOnly;
