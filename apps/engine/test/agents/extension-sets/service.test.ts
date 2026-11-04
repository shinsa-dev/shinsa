import { describe, expect, test } from 'bun:test';
import { createState } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { SessionExtensionSets } from '../../../src/agents/extension-sets/service.ts';
import { Transcripts } from '../../../src/agents/transcripts/service.ts';
import type { EngineCore } from '../../../src/runtime/engine/service.ts';
import { EngineCore as EngineCoreService } from '../../../src/runtime/engine/service.ts';
import { createTempDir } from '../../helpers/index.ts';
import { createRun } from '../../helpers/state.ts';
import { createTranscriptsLayer } from '../../helpers/transcripts.ts';

describe('the extension set of each session', () => {
  test('reads the last set a session announced from its runs’ transcripts, and remembers what it records', async () => {
    const state = createState();
    state.runs.a = createRun({ id: 'a', sessionId: 's1', startedAt: 1 });
    state.runs.b = createRun({ id: 'b', sessionId: 's1', startedAt: 2 });
    const first = { servers: [{ name: 'maple', tokens: 4000 }], skills: [], plugins: [] };
    const second = { ...first, servers: [{ name: 'linear', tokens: 1000 }] };
    const engine = { state: Effect.succeed(state) } as unknown as EngineCore['Service'];
    await Effect.runPromise(
      Effect.gen(function* () {
        const transcripts = yield* Transcripts;
        yield* transcripts.record('a', { type: 'notice', notice: { kind: 'extensions', ...first } });
        yield* transcripts.record('a', { type: 'notice', notice: { kind: 'extensions', ...second } });
        yield* transcripts.record('b', { type: 'agent', phase: 'final', text: 'Done.' });
        const sets = yield* SessionExtensionSets;
        expect(yield* sets.select('s1')).toEqual({ ...second, deferred: [] });
        expect(yield* sets.select('unknown')).toBeNull();
        yield* sets.record('s1', first);
        expect(yield* sets.select('s1')).toBe(first);
      }).pipe(
        Effect.provide(
          SessionExtensionSets.layer.pipe(
            Layer.provideMerge(createTranscriptsLayer(createTempDir())),
            Layer.provide(Layer.succeed(EngineCoreService, engine))
          )
        )
      )
    );
  });
});
