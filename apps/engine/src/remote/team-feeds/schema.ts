import type {
  ShareMessage,
  TeamFeedSnapshot,
  TeamFeedTask,
  TeamFeedStatus,
  TeamInitiative,
  TeamKeyRequest,
  TeamMachine,
  TeamPresence,
  TeamSnapshot,
  TeamTask,
  TeamView,
  TeamViewTarget,
} from '@shinsa/core';
import { Context, Duration, Effect, Schedule, Schema, type Scope } from 'effect';
import type { ChannelPeer } from '../channel/schema.ts';

export const TEAM_FEED_OFFLINE = 'The teammate’s machine is offline.';

export const TEAM_FEED_REFUSED = 'The teammate’s machine does not let this machine see its team tasks.';

export const TEAM_VIEW_GONE = 'This task is not shown to your team any more.';

export const TEAM_RETRY = Schedule.duration('1 second').pipe(
  Schedule.concat(Schedule.duration('2 seconds')),
  Schedule.concat(Schedule.duration('5 seconds')),
  Schedule.concat(Schedule.duration('10 seconds')),
  Schedule.concat(Schedule.spaced('30 seconds'))
);

export const TEAM_REFUSED_RETRY = Schedule.duration('1 minute').pipe(
  Schedule.concat(Schedule.duration('2 minutes')),
  Schedule.concat(Schedule.spaced('5 minutes'))
);

export const TEAM_VIEW_REFRESH = Duration.seconds(30);

export const TEAM_VIEW_FETCH_TIMEOUT = Duration.seconds(30);

export const ListViewText = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(Schema.Unknown),
    initiatives: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    machineKey: Schema.optionalKey(Schema.String),
    grant: Schema.optionalKey(Schema.String),
    updatedAt: Schema.Number,
    snapshot: Schema.optionalKey(Schema.Unknown),
    held: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    presence: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  })
);

export class TeamConnectFailed extends Schema.TaggedError<
  TeamConnectFailed,
  { readonly brand: unique symbol }
>()('TeamConnectFailed', { tag: Schema.NullOr(Schema.String), message: Schema.String }) {}

export class TeamFeedUnreadable extends Schema.TaggedError<
  TeamFeedUnreadable,
  { readonly brand: unique symbol }
>()('TeamFeedUnreadable', { message: Schema.String }) {}

export interface FeedSocket {
  binaryType: string;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (
    type: 'open' | 'message' | 'close',
    listener: (event: { data?: unknown }) => void
  ) => void;
}

export type FeedSocketEvent =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'message'; readonly data: unknown };

export interface TeamStreamEnd {
  reason: string;
  gone: boolean;
  keyRequest?: TeamKeyRequest;
}

export interface TeamStreamHandlers {
  onMessage: (message: ShareMessage) => void;
  onEnd: (end: TeamStreamEnd) => void;
}

export interface TeamStreamTarget {
  teamId: string;
  instanceId: string;
  key: string;
  view: TeamView;
}

export interface TeamFeedSettingsShape {
  readonly createSocket: (url: string, origin: string) => FeedSocket;
  readonly wait: (delay: Duration.Duration) => Effect.Effect<void>;
  readonly waitForViews: (delay: Duration.Duration) => Effect.Effect<void>;
}

export const TeamFeedSettings = Context.Reference<TeamFeedSettingsShape>(
  'shinsa/engine/remote/team-feeds/TeamFeedSettings',
  {
    defaultValue: () => ({
      createSocket: (url, origin) =>
        new WebSocket(url, { headers: { Origin: origin } }) as unknown as FeedSocket,
      wait: Effect.sleep,
      waitForViews: Effect.sleep,
    }),
  }
);

export interface Feed {
  readonly id: string;
  readonly token: number;
  readonly teamId: string;
  readonly key: string;
  readonly keyDigest: string;
  readonly machine: TeamMachine;
  readonly status: TeamFeedStatus;
  readonly reason: string | null;
  readonly tasks: TeamTask[];
  readonly initiatives: TeamInitiative[];
  readonly presence: TeamPresence[];
  readonly updatedAt: number | null;
  readonly snapshot: TeamSnapshot | null;
  readonly machineKey: string | null;
  readonly grant: string | null;
  readonly attempt: number;
  readonly asking: boolean;
}

export interface TeamFeedGrant {
  readonly teamId: string;
  readonly machine: TeamMachine;
  readonly machineKey: string;
  readonly grant: string | null;
}

export type HeldCloses = ReadonlyMap<number, Effect.Effect<void>>;

export interface TeamTaskFilter {
  teamId?: string | null;
  open?: boolean;
}

export interface TeamRelay {
  readonly close: Effect.Effect<void>;
}

export interface TeamFeedsHandle {
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly sync: Effect.Effect<void>;
  observe(listener: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
  observeHeld(listener: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
  listTasks(filter: TeamTaskFilter): Effect.Effect<TeamFeedTask[]>;
  listHeld(teamId: string): Effect.Effect<TeamSnapshot[]>;
  readonly snapshot: Effect.Effect<TeamFeedSnapshot>;
  readonly listGrants: Effect.Effect<TeamFeedGrant[]>;
  openRelay(peer: ChannelPeer, target: TeamViewTarget): Effect.Effect<TeamRelay>;
  openStream(target: TeamStreamTarget, handlers: TeamStreamHandlers): Effect.Effect<void>;
  answerKeyRequest(teamId: string, instanceId: string, approve: boolean): Effect.Effect<boolean>;
}
