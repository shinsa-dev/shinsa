import type { RelayHeaders, RelayOpen } from '@shinsa/core';
import { Option, Predicate } from 'effect';
import type { Socket } from 'effect/socket';
import {
  RELAY_DROPPED_REQUEST_HEADERS,
  RELAY_DROPPED_RESPONSE_HEADERS,
  RELAY_FORWARDED_HEADER,
  RELAY_PROTOCOL_HEADER,
  RELAY_SENDABLE_CLOSE,
  RELAY_UNKNOWN_ADDRESS,
} from './schema.ts';

const REFUSAL_STATUS = /status code: (\d{3})/;

export function resolveLocalTarget(localUrl: string, path: string, socket: boolean) {
  const origin = new URL(localUrl).origin;
  return `${socket ? origin.replace(/^http/, 'ws') : origin}${path}`;
}

export function resolveDialHeaders(open: RelayOpen) {
  const headers: Record<string, string> = {};
  for (const [name, value] of open.headers) {
    const lower = name.toLowerCase();
    if (!RELAY_DROPPED_REQUEST_HEADERS.has(lower)) headers[lower] = value;
  }
  headers[RELAY_FORWARDED_HEADER] = open.address ?? RELAY_UNKNOWN_ADDRESS;
  return headers;
}

export function listSocketProtocols(open: RelayOpen) {
  return open.headers
    .filter(([name]) => name.toLowerCase() === RELAY_PROTOCOL_HEADER)
    .flatMap(([, value]) => value.split(','))
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

export function listResponseHeaders(headers: Headers): RelayHeaders {
  return [...headers].filter(([name]) => !RELAY_DROPPED_RESPONSE_HEADERS.has(name.toLowerCase()));
}

export function resolveCloseCode(code: number) {
  const { min, max, reserved } = RELAY_SENDABLE_CLOSE;
  return code >= min && code <= max && !reserved.has(code) ? code : 1000;
}

export function selectRefusalStatus(error: Socket.SocketError): Option.Option<number> {
  if (error.reason._tag !== 'SocketOpenError') return Option.none();
  const cause: unknown = error.reason.cause;
  const message = Predicate.hasProperty(cause, 'message') ? String(cause.message) : '';
  const status = REFUSAL_STATUS.exec(message)?.[1];
  return status === undefined ? Option.none() : Option.some(Number(status));
}

export function describeSocketError(error: Socket.SocketError) {
  const reason = error.reason;
  if (reason._tag === 'SocketCloseError') return reason.closeReason ?? `Closed with code ${reason.code}.`;
  const cause: unknown = reason.cause;
  return Predicate.hasProperty(cause, 'message') ? String(cause.message) : reason.message;
}

export function selectSocketProtocol(socket: Socket.WebSocketLike | null): Option.Option<string> {
  if (socket && 'protocol' in socket && typeof socket.protocol === 'string' && socket.protocol !== '')
    return Option.some(socket.protocol);
  return Option.none();
}
