import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  parseSharedTranscript,
  resetSharedTranscripts,
  selectSharedTranscript,
  syncSharedTranscripts,
  useSharedTranscript,
} from '@/lib/share/transcripts.ts';
import { createAgentEntry } from '../../support/chat.ts';

afterEach(() => resetSharedTranscripts());

const ENTRY = createAgentEntry('Reading the code.', 'interim', 1, 'e1');

describe('the transcripts an Everything share streams', () => {
  it('reads only chat entries from the file, and nothing from one it cannot read', () => {
    expect(parseSharedTranscript(JSON.stringify([ENTRY, { type: 'nope' }]))).toEqual([ENTRY]);
    expect(parseSharedTranscript('{"not":"a list"}')).toEqual([]);
    expect(parseSharedTranscript('not json')).toEqual([]);
  });

  it('reads each run’s file once per version and hands it to the chat', async () => {
    const reads: string[] = [];
    const readText = (url: string) => {
      reads.push(url);
      return Promise.resolve(JSON.stringify([ENTRY]));
    };
    const { result } = renderHook(() => useSharedTranscript('run-1'));
    expect(result.current).toBeNull();
    await act(() => syncSharedTranscripts({ 'run-1': 'blob:1' }, readText));
    await act(() => syncSharedTranscripts({ 'run-1': 'blob:1' }, readText));
    expect(reads).toEqual(['blob:1']);
    expect(result.current).toEqual([ENTRY]);
    expect(selectSharedTranscript(null)).toBeNull();
  });

  it('reads a file again after it failed, and keeps the newer version when an older read ends last', async () => {
    let fail = true;
    const readText = (url: string) =>
      fail
        ? Promise.reject(new Error('gone'))
        : Promise.resolve(JSON.stringify(url === 'blob:2' ? [ENTRY] : []));
    await syncSharedTranscripts({ 'run-1': 'blob:1' }, readText);
    expect(selectSharedTranscript('run-1')).toBeNull();
    fail = false;
    let release: (text: string) => void = () => undefined;
    const slow = syncSharedTranscripts(
      { 'run-1': 'blob:1' },
      () => new Promise((resolve) => (release = resolve))
    );
    await syncSharedTranscripts({ 'run-1': 'blob:2' }, readText);
    release('[]');
    await slow;
    expect(selectSharedTranscript('run-1')).toEqual([ENTRY]);
  });

  it('keeps nothing once reset', async () => {
    await syncSharedTranscripts({ 'run-1': 'blob:1' }, () => Promise.resolve(JSON.stringify([ENTRY])));
    resetSharedTranscripts();
    expect(selectSharedTranscript('run-1')).toBeNull();
  });
});
