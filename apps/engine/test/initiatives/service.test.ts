import { describe, expect, test } from 'bun:test';
import type { Initiative, InitiativeMilestone, ShinsaState } from '@shinsa/core';
import { Duration, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { LeadWakeDebounce } from '../../src/initiatives/schema.ts';
import { LeadWakes } from '../../src/initiatives/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { createStubEngineCoreLayer } from '../helpers/engine-core.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createStubEngine, type StubEngine } from '../helpers/state.ts';

const MILESTONE: InitiativeMilestone = { taskId: 't-member', kind: 'merged', text: 'Merged', at: 1 };

function createInitiative(id: string, patch: Partial<Initiative> = {}): Initiative {
  return {
    id,
    name: id,
    description: '',
    phases: [],
    leadTaskId: `lead-${id}`,
    createdAt: 0,
    updatedAt: 0,
    milestones: [MILESTONE],
    ...patch,
  };
}

function writeInitiatives(state: ShinsaState, initiatives: Initiative[]) {
  state.initiatives = Object.fromEntries(initiatives.map((initiative) => [initiative.id, initiative]));
}

function listWoken(stub: StubEngine) {
  return stub.dispatched.flatMap((command) =>
    command.type === 'initiative.wake_lead' ? [command.initiativeId] : []
  );
}

function runWakes(stub: StubEngine, use: (wakes: LeadWakes['Service']) => Effect.Effect<void>) {
  return Effect.runPromise(
    LeadWakes.use(use).pipe(
      Effect.provide(
        Layer.mergeAll(
          LeadWakes.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                createStubEngineCoreLayer(stub),
                Layer.succeed(LeadWakeDebounce, Duration.seconds(30))
              )
            )
          ),
          TestClock.layer(),
          JsonLogger
        )
      )
    )
  );
}

const settle = Effect.andThen(Effect.yieldNow, Effect.yieldNow);

describe('lead wakes', () => {
  test('milestones within the window wake the lead once, at the end of the first request’s window', async () => {
    const stub = createStubEngine();
    const seen: string[][] = [];
    await runWakes(stub, (wakes) =>
      Effect.gen(function* () {
        yield* wakes.schedule('chat');
        yield* TestClock.adjust('20 seconds');
        yield* wakes.schedule('chat');
        yield* TestClock.adjust('9 seconds');
        seen.push(listWoken(stub));
        yield* TestClock.adjust('1 second');
        yield* settle;
        seen.push(listWoken(stub));
        yield* wakes.schedule('chat');
        yield* TestClock.adjust('30 seconds');
        yield* settle;
        seen.push(listWoken(stub));
      })
    );
    expect(seen).toEqual([[], ['chat'], ['chat', 'chat']]);
  });

  test('each initiative waits on its own window', async () => {
    const stub = createStubEngine();
    await runWakes(stub, (wakes) =>
      Effect.gen(function* () {
        yield* wakes.schedule('chat');
        yield* TestClock.adjust('15 seconds');
        yield* wakes.schedule('billing');
        yield* TestClock.adjust('15 seconds');
        yield* settle;
        expect(listWoken(stub)).toEqual(['chat']);
        yield* TestClock.adjust('15 seconds');
        yield* settle;
      })
    );
    expect(listWoken(stub)).toEqual(['chat', 'billing']);
  });

  test('once stopped, a waiting wake and a later request wake nothing', async () => {
    const stub = createStubEngine();
    await runWakes(stub, (wakes) =>
      Effect.gen(function* () {
        yield* wakes.schedule('chat');
        yield* wakes.stop;
        yield* wakes.schedule('chat');
        yield* TestClock.adjust('1 minute');
        yield* settle;
      })
    );
    expect(listWoken(stub)).toEqual([]);
  });

  test('a wake the engine refuses is logged, and the next request still wakes', async () => {
    const stub = createStubEngine();
    stub.reject((command) => command.type === 'initiative.wake_lead' && stub.dispatched.length === 1);
    const logs = captureLogs();
    try {
      await runWakes(stub, (wakes) =>
        Effect.gen(function* () {
          yield* wakes.schedule('chat');
          yield* TestClock.adjust('30 seconds');
          yield* settle;
          yield* wakes.schedule('chat');
          yield* TestClock.adjust('30 seconds');
          yield* settle;
        })
      );
      expect(logs.fieldsOf('[Leads] Could not wake the lead')).toEqual([
        { initiativeId: 'chat', error: 'rejected' },
      ]);
    } finally {
      logs.restore();
    }
    expect(listWoken(stub)).toEqual(['chat', 'chat']);
  });

  test('on start, every initiative with a lead and queued milestones gets a wake', async () => {
    const stub = createStubEngine((state) =>
      writeInitiatives(state, [
        createInitiative('chat'),
        createInitiative('quiet', { milestones: [] }),
        createInitiative('unread', { milestones: undefined }),
        createInitiative('leaderless', { leadTaskId: null }),
        createInitiative('billing'),
      ])
    );
    await runWakes(stub, (wakes) =>
      Effect.gen(function* () {
        yield* wakes.recover;
        yield* TestClock.adjust('30 seconds');
        yield* settle;
      })
    );
    expect([...listWoken(stub)].sort()).toEqual(['billing', 'chat']);
  });

  test('a lead waits 30 seconds of milestones before it wakes, unless told otherwise', () => {
    expect(Duration.toMillis(Effect.runSync(LeadWakeDebounce))).toBe(30_000);
  });
});
