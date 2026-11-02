import { type Effect, Schedule, Schema } from 'effect';
import type { ReconnectPlan, SocketFrame } from '@/lib/runtime/socket/schema.ts';

export const TERMINAL_SOCKET_PATH = '/ws/terminals/';

export const TERMINAL_GONE_CODE = 4404;

const TERMINAL_REDIAL = '250 millis';

const TERMINAL_BACKOFF = Schedule.duration('1 second').pipe(
  Schedule.concat(Schedule.duration('2 seconds')),
  Schedule.concat(Schedule.spaced('5 seconds'))
);

export const TERMINAL_RECONNECT: ReconnectPlan = {
  first: Schedule.duration(TERMINAL_REDIAL).pipe(Schedule.concat(TERMINAL_BACKOFF)),
  backoff: TERMINAL_BACKOFF,
  redial: TERMINAL_REDIAL,
};

export class TerminalSocketClosed extends Schema.TaggedError<
  TerminalSocketClosed,
  { readonly brand: unique symbol }
>()('TerminalSocketClosed', { connected: Schema.Boolean, final: Schema.Boolean }) {}

export interface TerminalLink {
  isOpen(): boolean;
  send(frame: SocketFrame): Effect.Effect<void>;
}

export interface TerminalSession {
  opened(link: TerminalLink): void;
  received(frame: SocketFrame): void;
  closed(gone: boolean): void;
}
