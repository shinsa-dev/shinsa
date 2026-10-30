import { type Bytes, parseBase64Url, serializeBase64Url } from './bytes.ts';

export const CHANNEL_BODY_CHUNK_BYTES = 256 * 1024;

export type ChannelHeaders = [string, string][];

export type ChannelMessage =
  | { t: 'ready' }
  | { t: 'socket'; data: string }
  | { t: 'request'; id: string; method: string; path: string; headers: ChannelHeaders }
  | { t: 'response'; id: string; status: number; headers: ChannelHeaders }
  | { t: 'body'; id: string; chunk: string }
  | { t: 'end'; id: string }
  | { t: 'abort'; id: string };

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

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
      return null;
  }
}

export function parseChannelMessage(text: string): ChannelMessage | null {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    return readMessage(value as Record<string, unknown>);
  } catch {
    return null;
  }
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
