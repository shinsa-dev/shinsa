import type { TeamView } from '@shinsa/core';
import { Schedule, Schema } from 'effect';
import type { ReconnectPlan } from '@/lib/runtime/socket/schema.ts';
import type { ShareContent } from '@/lib/share/share-socket/schema.ts';

export const TEAM_MACHINE_OFFLINE =
  'The teammate’s machine is offline. This page opens the task again as soon as it is back.';

export const TEAM_TASK_GONE =
  'This task is not shown to your team any more, or you are no longer in the team.';

export const TEAM_GONE_STATUSES: ReadonlySet<number> = new Set([403, 404]);

const TEAM_REDIAL = '1 second';

const TEAM_BACKOFF = Schedule.duration('2 seconds').pipe(
  Schedule.concat(Schedule.duration('5 seconds')),
  Schedule.concat(Schedule.duration('10 seconds')),
  Schedule.concat(Schedule.spaced('30 seconds'))
);

export const TEAM_RECONNECT: ReconnectPlan = {
  first: Schedule.duration(TEAM_REDIAL).pipe(Schedule.concat(TEAM_BACKOFF)),
  backoff: TEAM_BACKOFF,
  redial: TEAM_REDIAL,
};

export class TeamChannelEnded extends Schema.TaggedError<
  TeamChannelEnded,
  { readonly brand: unique symbol }
>()('TeamChannelEnded', { reason: Schema.String, gone: Schema.Boolean }) {}

export class TeamStreamDropped extends Schema.TaggedError<
  TeamStreamDropped,
  { readonly brand: unique symbol }
>()('TeamStreamDropped', { connected: Schema.Boolean, final: Schema.Boolean }) {}

export interface TeamChannelEnd {
  reason: string;
  gone: boolean;
}

export interface TeamChannelHandlers {
  onMessage: (message: ShareContent) => void;
  onEnd: (end: TeamChannelEnd) => void;
}

export type TeamTransport = (handlers: TeamChannelHandlers) => () => void;

export interface TeamChannelTarget {
  teamId: string;
  instanceId: string;
  key: string;
  view: TeamView;
}
