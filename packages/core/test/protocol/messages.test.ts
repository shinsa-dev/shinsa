import { describe, expect, test } from 'bun:test';
import { Option, Schema } from 'effect';
import { isQuietSurface, isSurface, parseClientMessage } from '../../src/protocol/messages.ts';
import { SURFACES, ServerMessage } from '../../src/protocol/schema.ts';

describe('isSurface', () => {
  test('knows the desktop app and a browser page, nothing else', () => {
    expect(SURFACES.every(isSurface)).toBe(true);
    expect(isSurface('floaty')).toBe(false);
    expect(isSurface(null)).toBe(false);
    expect(isSurface({ surface: 'desktop' })).toBe(false);
  });
});

describe('isQuietSurface', () => {
  test('a browser page stays quiet while the desktop app is connected', () => {
    expect(isQuietSurface('browser', true)).toBe(true);
    expect(isQuietSurface('browser', false)).toBe(false);
  });

  test('the desktop app always notifies', () => {
    expect(isQuietSurface('desktop', true)).toBe(false);
    expect(isQuietSurface('desktop', false)).toBe(false);
  });
});

describe('parseClientMessage', () => {
  test('reads each message a page sends, without the fields it does not know', () => {
    const read = (message: unknown): unknown => parseClientMessage(JSON.stringify(message));
    expect(read({ type: 'hello', surface: 'desktop', extra: 1 })).toEqual({
      type: 'hello',
      surface: 'desktop',
    });
    expect(read({ type: 'state.sync' })).toEqual({ type: 'state.sync' });
    expect(read({ type: 'presence', active: true })).toEqual({ type: 'presence', active: true });
    expect(read({ type: 'task.detail', taskId: 't-1' })).toEqual({ type: 'task.detail', taskId: 't-1' });
    expect(read({ type: 'command', id: 'c-1', command: { type: 'task.cancel' } })).toEqual({
      type: 'command',
      id: 'c-1',
      command: { type: 'task.cancel' },
    });
    expect(read({ type: 'command', id: 'c-1' })).toEqual({ type: 'command', id: 'c-1' });
    expect(read({ type: 'transcript.unsubscribe', runId: 'r-1' })).toEqual({
      type: 'transcript.unsubscribe',
      runId: 'r-1',
    });
  });

  test('a transcript is read from the start unless it names a whole index', () => {
    const read = (from: unknown): unknown =>
      parseClientMessage(JSON.stringify({ type: 'transcript.subscribe', runId: 'r-1', from }));
    expect(read(40)).toEqual({ type: 'transcript.subscribe', runId: 'r-1', from: 40 });
    for (const from of [-1, 1.5, 'x', null])
      expect(read(from)).toEqual({ type: 'transcript.subscribe', runId: 'r-1', from: 0 });
    expect(parseClientMessage(JSON.stringify({ type: 'transcript.subscribe', runId: 'r-1' }))?.type).toBe(
      'transcript.subscribe'
    );
  });

  test('refuses what is not a Shinsa message', () => {
    for (const text of [
      'not json',
      'null',
      '[]',
      JSON.stringify({ type: 'hello', surface: 'floaty' }),
      JSON.stringify({ type: 'task.detail', taskId: '' }),
      JSON.stringify({ type: 'command', id: 'x'.repeat(201) }),
      JSON.stringify({ type: 'transcript.unsubscribe' }),
      JSON.stringify({ type: 'shutdown' }),
      JSON.stringify({ type: 'presence' }),
    ])
      expect(parseClientMessage(text)).toBeNull();
  });
});

describe('ServerMessage', () => {
  const read = (message: unknown): unknown =>
    Option.getOrNull(
      Schema.decodeUnknownOption(Schema.fromJsonString(ServerMessage))(JSON.stringify(message))
    );

  test('reads each message the engine pushes', () => {
    const state = { seq: 4, tasks: {}, runs: {} };
    expect(read({ type: 'state', state })).toEqual({ type: 'state', state });
    expect(read({ type: 'ack', id: 'c1', error: null })).toEqual({ type: 'ack', id: 'c1', error: null });
    expect(read({ type: 'ack', id: 'c1', error: { code: 'refused', message: 'No.' } })).toEqual({
      type: 'ack',
      id: 'c1',
      error: { code: 'refused', message: 'No.' },
    });
    expect(read({ type: 'transcript', runId: 'r1', entries: [{ kind: 'text' }], start: 0 })).toEqual({
      type: 'transcript',
      runId: 'r1',
      entries: [{ kind: 'text' }],
      start: 0,
    });
    expect(read({ type: 'surfaces', desktop: true })).toEqual({ type: 'surfaces', desktop: true });
    for (const where of ['here', 'elsewhere', 'nowhere'])
      expect(read({ type: 'attention', where })).toEqual({ type: 'attention', where });
    const snapshots = {
      'state.patch': 'patch',
      'task.detail': 'detail',
      accounts: 'accounts',
      terminals: 'terminals',
      resources: 'resources',
      remote: 'remote',
      teams: 'teams',
    };
    for (const [type, field] of Object.entries(snapshots)) {
      expect(read({ type, [field]: { seq: 1 } })).toEqual({ type, [field]: { seq: 1 } });
    }
    expect(
      read({ type: 'engine', engine: { version: '1.2.0', protocol: 3, commands: [], features: [] } })
    ).toEqual({
      type: 'engine',
      engine: { version: '1.2.0', protocol: 3, commands: [], features: [] },
    });
  });

  test('refuses a message it does not know or whose payload is not an object', () => {
    expect(read({ type: 'hello' })).toBeNull();
    expect(read({ type: 'state', state: 4 })).toBeNull();
    expect(read({ type: 'state', state: { tasks: {} } })).toBeNull();
    expect(read({ type: 'ack', id: 'c1' })).toBeNull();
    expect(read({ type: 'transcript', runId: 'r1', entries: ['line'], start: 0 })).toBeNull();
    expect(read({ type: 'accounts', accounts: null })).toBeNull();
    expect(read({ type: 'attention', where: 'somewhere' })).toBeNull();
  });
});
