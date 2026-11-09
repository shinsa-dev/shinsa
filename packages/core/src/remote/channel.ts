import { Option } from 'effect';
import { isText, parseJsonRecord } from '../domain/records.ts';
import { type Bytes, parseBase64Url, serializeBase64Url } from './bytes.ts';

export const CHANNEL_BODY_CHUNK_BYTES = 256 * 1024;

export const TERMINAL_STREAM_CLOSE = { normal: 1000, refused: 4403, gone: 4404 } as const;

export const MAX_TERMINAL_STREAMS = 16;

export type ChannelHeaders = [string, string][];

export type ChannelMessage =
  | { t: 'ready' }
  | { t: 'socket'; data: string }
  | { t: 'request'; id: string; method: string; path: string; headers: ChannelHeaders }
  | { t: 'response'; id: string; status: number; headers: ChannelHeaders }
  | { t: 'body'; id: string; chunk: string }
  | { t: 'end'; id: string }
  | { t: 'abort'; id: string }
  | { t: 'terminal-open'; id: string; terminal: string }
  | { t: 'terminal-text'; id: string; data: string }
  | { t: 'terminal-bytes'; id: string; chunk: string }
  | { t: 'terminal-close'; id: string; code: number; reason: string };

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

function isHeaders(value: unknown): value is ChannelHeaders {
  return (
    Array.isArray(value) &&
    value.every((pair) => Array.isArray(pair) && pair.length === 2 && isText(pair[0]) && isText(pair[1]))
  );
}

function readMessage(fields: Record<string, unknown>): ChannelMessage | null {
  const { id } = fields;
  switch (fields.t) {
    case 'ready':
      return { t: 'ready' };
    case 'socket':
      return isText(fields.data) ? { t: 'socket', data: fields.data } : null;
    case 'request':
      if (!isText(id) || !isText(fields.method) || !METHODS.has(fields.method)) return null;
      if (!isText(fields.path) || !fields.path.startsWith('/') || !isHeaders(fields.headers)) return null;
      return { t: 'request', id, method: fields.method, path: fields.path, headers: fields.headers };
    case 'response':
      if (!isText(id) || !Number.isInteger(fields.status) || !isHeaders(fields.headers)) return null;
      return { t: 'response', id, status: fields.status as number, headers: fields.headers };
    case 'body':
      return isText(id) && isText(fields.chunk) ? { t: 'body', id, chunk: fields.chunk } : null;
    case 'end':
    case 'abort':
      return isText(id) ? { t: fields.t, id } : null;
    default:
      return isText(id) ? readTerminalMessage(id, fields) : null;
  }
}

function readTerminalMessage(id: string, fields: Record<string, unknown>): ChannelMessage | null {
  switch (fields.t) {
    case 'terminal-open':
      return isText(fields.terminal) ? { t: 'terminal-open', id, terminal: fields.terminal } : null;
    case 'terminal-text':
      return isText(fields.data) ? { t: 'terminal-text', id, data: fields.data } : null;
    case 'terminal-bytes':
      return isText(fields.chunk) ? { t: 'terminal-bytes', id, chunk: fields.chunk } : null;
    case 'terminal-close':
      if (!Number.isInteger(fields.code) || !isText(fields.reason)) return null;
      return { t: 'terminal-close', id, code: fields.code as number, reason: fields.reason };
    default:
      return null;
  }
}

export function parseChannelMessage(text: string): Option.Option<ChannelMessage> {
  return Option.flatMapNullishOr(parseJsonRecord(text), readMessage);
}

export function serializeChannelMessage(message: ChannelMessage) {
  return JSON.stringify(message);
}

export function listBodyMessages(id: string, body: Bytes): ChannelMessage[] {
  const messages: ChannelMessage[] = [];
  for (let offset = 0; offset < body.length; offset += CHANNEL_BODY_CHUNK_BYTES) {
    const chunk = serializeBase64Url(body.slice(offset, offset + CHANNEL_BODY_CHUNK_BYTES));
    messages.push({ t: 'body', id, chunk });
  }
  messages.push({ t: 'end', id });
  return messages;
}

export function parseBodyChunk(chunk: string) {
  return parseBase64Url(chunk);
}
