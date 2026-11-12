import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import { decodeText, encodeText } from '../../../src/remote/bytes.ts';
import {
  listRelayBodyFrames,
  parseRelayControl,
  parseRelayData,
  RELAY_PING,
  RELAY_PONG,
  serializeRelayControl,
  serializeRelayData,
} from '../../../src/remote/relay/codec.ts';
import {
  RELAY_CHUNK_BYTES,
  RELAY_DATA_HEADER_BYTES,
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_MAX_STREAM_ID,
  type RelayControl,
  RelayStreamId,
} from '../../../src/remote/relay/schema.ts';

const STREAM = RelayStreamId.make(7);

describe('relay control frames', () => {
  test('carry a stream open, its response, its end and its close through JSON unchanged', () => {
    const frames: RelayControl[] = [
      {
        type: 'open',
        stream: STREAM,
        kind: 'socket',
        method: 'GET',
        path: '/remote?token=abc',
        headers: [['sec-websocket-protocol', 'shinsa']],
        address: '203.0.113.9',
      },
      { type: 'open', stream: STREAM, kind: 'http', method: 'POST', path: '/api/hooks/s/t', headers: [] },
      { type: 'response', stream: STREAM, status: 200, headers: [['content-type', 'text/html']] },
      { type: 'end', stream: STREAM },
      { type: 'close', stream: STREAM, code: 4001, reason: 'The machine went offline.' },
      { type: 'ping' },
      { type: 'pong' },
    ];
    for (const frame of frames)
      expect(parseRelayControl(serializeRelayControl(frame))).toEqual(Option.some(frame));
  });

  test('keeps ping and pong as the exact text the relay answers without waking', () => {
    expect(RELAY_PING).toBe('{"type":"ping"}');
    expect(RELAY_PONG).toBe('{"type":"pong"}');
  });

  test('refuses a frame that is not JSON, of no known type, or with a field out of range', () => {
    const refused = [
      'not json',
      '{"type":"hello"}',
      '{"type":"end"}',
      '{"type":"end","stream":0}',
      `{"type":"end","stream":${RELAY_MAX_STREAM_ID + 1}}`,
      '{"type":"end","stream":1.5}',
      '{"type":"open","stream":1,"kind":"ftp","method":"GET","path":"/","headers":[]}',
      '{"type":"open","stream":1,"kind":"http","method":"get","path":"/","headers":[]}',
      '{"type":"open","stream":1,"kind":"http","method":"GET","path":"remote","headers":[]}',
      '{"type":"open","stream":1,"kind":"http","method":"GET","path":"/","headers":[["a"]]}',
      '{"type":"response","stream":1,"status":99,"headers":[]}',
      '{"type":"response","stream":1,"status":600,"headers":[]}',
      '{"type":"close","stream":1,"code":999,"reason":""}',
      `{"type":"close","stream":1,"code":1000,"reason":"${'x'.repeat(121)}"}`,
    ];
    for (const text of refused) expect(Option.isNone(parseRelayControl(text))).toBe(true);
  });
});

describe('relay data frames', () => {
  test('put the kind and the stream in a five-byte header before the payload', () => {
    const frame = serializeRelayData({
      stream: RelayStreamId.make(0x01_02_03_04),
      kind: 'text',
      payload: encodeText('hi'),
    });
    expect(Array.from(frame)).toEqual([2, 1, 2, 3, 4, 104, 105]);
    const read = Option.getOrThrow(parseRelayData(frame));
    expect(read.stream).toBe(RelayStreamId.make(0x01_02_03_04));
    expect(read.kind).toBe('text');
    expect(decodeText(read.payload)).toBe('hi');
  });

  test('read a binary frame and an empty payload, from a view into a larger buffer too', () => {
    const frame = serializeRelayData({
      stream: RelayStreamId.make(RELAY_MAX_STREAM_ID),
      kind: 'binary',
      payload: new Uint8Array([9, 8]),
    });
    const larger = new Uint8Array(frame.length + 3);
    larger.set(frame, 3);
    const read = Option.getOrThrow(parseRelayData(larger.subarray(3)));
    expect(read).toEqual({
      stream: RelayStreamId.make(RELAY_MAX_STREAM_ID),
      kind: 'binary',
      payload: new Uint8Array([9, 8]),
    });
    const empty = Option.getOrThrow(
      parseRelayData(serializeRelayData({ stream: STREAM, kind: 'binary', payload: new Uint8Array() }))
    );
    expect(empty.payload.length).toBe(0);
  });

  test('refuse a frame shorter than its header, past the size limit, of an unknown kind or stream 0', () => {
    expect(Option.isNone(parseRelayData(new Uint8Array(RELAY_DATA_HEADER_BYTES - 1)))).toBe(true);
    expect(Option.isNone(parseRelayData(new Uint8Array(RELAY_MAX_MESSAGE_BYTES + 1)))).toBe(true);
    expect(Option.isNone(parseRelayData(new Uint8Array([3, 0, 0, 0, 1])))).toBe(true);
    expect(Option.isNone(parseRelayData(new Uint8Array([1, 0, 0, 0, 0])))).toBe(true);
  });
});

describe('relay body frames', () => {
  test('split a body into binary frames of at most one chunk each, in order', () => {
    const body = new Uint8Array(RELAY_CHUNK_BYTES * 2 + 10).map((_, index) => index % 251);
    const frames = listRelayBodyFrames(STREAM, body);
    expect(frames.map((frame) => frame.length - RELAY_DATA_HEADER_BYTES)).toEqual([
      RELAY_CHUNK_BYTES,
      RELAY_CHUNK_BYTES,
      10,
    ]);
    const joined = frames.flatMap((frame) => Array.from(Option.getOrThrow(parseRelayData(frame)).payload));
    expect(joined).toEqual(Array.from(body));
    expect(frames.every((frame) => Option.getOrThrow(parseRelayData(frame)).kind === 'binary')).toBe(true);
  });

  test('send no frame for an empty body, and honour a smaller chunk', () => {
    expect(listRelayBodyFrames(STREAM, new Uint8Array())).toEqual([]);
    expect(listRelayBodyFrames(STREAM, encodeText('abcde'), 2)).toHaveLength(3);
  });
});
