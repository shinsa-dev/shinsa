import type { HeartbeatRequest, RemoteAccess, RemoteMember, RemoteTeam, TunnelStatus } from '@shinsa/core';
import { Context, type Effect, Schedule, Schema } from 'effect';
import type { MachineCalls, Token } from '../client/schema.ts';

export const PING_INTERVAL = '30 seconds';

export const PING_SCHEDULE = Schedule.spaced(PING_INTERVAL);

export const HEARTBEAT_INTERVAL = '2 minutes';

export const HEARTBEAT_SCHEDULE = Schedule.spaced(HEARTBEAT_INTERVAL);

export const REFUSED_STATUS = 401;

export const FAILED_PINGS_BEFORE_RESTART = 3;

export const QUICK_RESTART = '1 second';

export const RESTART_SCHEDULE = Schedule.spaced(QUICK_RESTART).pipe(
  Schedule.upTo({ duration: '1 minute' }),
  Schedule.concat(Schedule.duration('2 seconds')),
  Schedule.concat(Schedule.duration('4 seconds')),
  Schedule.concat(Schedule.duration('10 seconds')),
  Schedule.concat(Schedule.spaced('30 seconds'))
);

export class TunnelDropped extends Schema.TaggedError<TunnelDropped, { readonly brand: unique symbol }>()(
  'TunnelDropped',
  { healthy: Schema.Boolean, message: Schema.String }
) {}

export interface TunnelHost {
  readonly version: string;
  readonly localUrl: Effect.Effect<string>;
  readonly signingKey: Effect.Effect<string | null>;
  heartbeat(token: Token, request: HeartbeatRequest): ReturnType<MachineCalls['heartbeat']>;
  recordAccess(access: RemoteAccess, guests: RemoteMember[]): Effect.Effect<void>;
  recordTeams(teams: RemoteTeam[]): Effect.Effect<void>;
  recordStatus(status: TunnelStatus): Effect.Effect<void>;
  readonly forget: Effect.Effect<void>;
}

export class TunnelMachine extends Context.Service<TunnelMachine, TunnelHost>()(
  'shinsa/engine/remote/tunnel/TunnelMachine'
) {}
