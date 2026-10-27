import { describe, expect, test } from 'bun:test';
import { createState } from '@shinsa/core';
import { SessionExtensionSets } from '../../src/agents/extension-sets.ts';
import { Transcripts } from '../../src/agents/transcripts/index.ts';
import { createTempDir } from '../helpers/index.ts';
import { createRun } from '../helpers/state.ts';

describe('the extension set of each session', () => {
  test('reads the last set a session announced from its runs’ transcripts, and remembers what it records', () => {
    const state = createState();
    state.runs.a = createRun({ id: 'a', sessionId: 's1', startedAt: 1 });
    state.runs.b = createRun({ id: 'b', sessionId: 's1', startedAt: 2 });
    const transcripts = new Transcripts(createTempDir());
    const first = { servers: [{ name: 'maple', tokens: 4000 }], skills: [], plugins: [] };
    const second = { ...first, servers: [{ name: 'linear', tokens: 1000 }] };
    transcripts.record('a', { type: 'notice', notice: { kind: 'extensions', ...first } });
    transcripts.record('a', { type: 'notice', notice: { kind: 'extensions', ...second } });
    transcripts.record('b', { type: 'agent', phase: 'final', text: 'Done.' });
    const sets = new SessionExtensionSets(transcripts, () => state);
    expect(sets.select('s1')).toEqual({ ...second, deferred: [] });
    expect(sets.select('unknown')).toBeNull();
    sets.record('s1', first);
    expect(sets.select('s1')).toBe(first);
  });
});
