import { describe, expect, test } from 'bun:test';
import {
  CHANNEL_BODY_CHUNK_BYTES,
  type ChannelMessage,
  listBodyMessages,
  parseBodyChunk,
  parseChannelMessage,
  serializeChannelMessage,
} from '../../src/remote/channel.ts';

describe('channel messages', () => {
  test('round-trip every kind', () => {
    const messages: ChannelMessage[] = [
      { t: 'ready' },
      { t: 'socket', data: '{"type":"state.sync"}' },
      { t: 'request', id: 'r1', method: 'POST', path: '/api/commands', headers: [['content-type', 'x']] },
      { t: 'response', id: 'r1', status: 200, headers: [] },
      { t: 'body', id: 'r1', chunk: 'AAE' },
      { t: 'end', id: 'r1' },
      { t: 'abort', id: 'r1' },
    ];
    for (const message of messages)
      expect(parseChannelMessage(serializeChannelMessage(message))).toEqual(message);
  });

  test('keep only the fields a kind defines', () => {
    expect(parseChannelMessage('{"t":"ready","extra":1}')).toEqual({ t: 'ready' });
  });

  test('refuse anything else', () => {
    const refused = [
      '{',
      'null',
      '[]',
      '{"t":"other"}',
      '{"t":"socket","data":1}',
      '{"t":"request","id":"r","method":"TRACE","path":"/","headers":[]}',
      '{"t":"request","id":"r","method":"GET","path":"http://x/","headers":[]}',
      '{"t":"request","id":"r","method":"GET","path":"/","headers":[["a"]]}',
      '{"t":"request","id":1,"method":"GET","path":"/","headers":[]}',
      '{"t":"response","id":"r","status":2.5,"headers":[]}',
      '{"t":"response","id":"r","status":200,"headers":{}}',
      '{"t":"body","id":"r"}',
      '{"t":"end"}',
      '{"t":"abort","id":2}',
    ];
    for (const text of refused) expect(parseChannelMessage(text)).toBeNull();
  });

  test('split a body into chunks and an end, and read a chunk back', () => {
    const body = new Uint8Array(CHANNEL_BODY_CHUNK_BYTES + 3).fill(9);
    const messages = listBodyMessages('r1', body);
    expect(messages.map((message) => message.t)).toEqual(['body', 'body', 'end']);
    const second = messages[1] as { chunk: string };
    expect([...(parseBodyChunk(second.chunk) ?? [])]).toEqual([9, 9, 9]);
    expect(listBodyMessages('r2', new Uint8Array())).toEqual([{ t: 'end', id: 'r2' }]);
    expect(parseBodyChunk('!')).toBeNull();
  });
});
