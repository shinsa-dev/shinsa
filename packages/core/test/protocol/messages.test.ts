import { describe, expect, test } from 'bun:test';
import { isQuietSurface, isSurface, parseClientMessage, SURFACES } from '../../src/protocol/messages.ts';

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
    ])
      expect(parseClientMessage(text)).toBeNull();
  });
});
