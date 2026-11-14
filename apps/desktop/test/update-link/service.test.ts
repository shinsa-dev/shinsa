import { describe, expect, it } from 'bun:test';
import type { AppUpdateRequest } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { resolveAppUpdateReport } from '../../src/update-link/report.ts';
import type { UpdateEvent } from '../../src/updates/schema.ts';
import { Updater } from '../../src/updates/service.ts';
import {
  answerJson,
  createWorld,
  type DesktopWorld,
  emitUpdate,
  flush,
  type HttpAnswer,
  runLinked,
  USER_DATA,
} from '../support/desktop.ts';

const REPORT = '/api/app-updates/report';

const PREFS = `${USER_DATA}/prefs.json`;

function answerOnce(...requests: AppUpdateRequest[]) {
  let given = false;
  return (path: string): HttpAnswer => {
    if (path !== REPORT) return 'refuse';
    const answer = answerJson({ requests: given ? [] : requests });
    given = true;
    return answer;
  };
}

function listReports(world: DesktopWorld) {
  return world.posted.filter((post) => post.path === REPORT).map((post) => JSON.parse(post.body));
}

function emit(world: DesktopWorld, ...events: UpdateEvent[]) {
  return Effect.andThen(
    Effect.forEach(events, (event) => emitUpdate(world, event)),
    flush
  );
}

function run<A>(world: DesktopWorld, body: (updater: Updater['Service']) => Effect.Effect<A>, start = false) {
  return runLinked(
    world,
    Updater.use((updater) =>
      Effect.gen(function* () {
        if (start) yield* updater.start;
        yield* flush;
        const result = yield* body(updater);
        yield* flush;
        return result;
      })
    )
  );
}

describe('resolveAppUpdateReport', () => {
  it('reports the app’s version, protocol, channel and the page’s shape of its update', () => {
    expect(
      resolveAppUpdateReport(
        {
          state: { status: 'downloading', version: '1.3.0', percent: 41.6 },
          channel: 'beta',
          supported: true,
        },
        '1.2.0'
      )
    ).toEqual({
      version: '1.2.0',
      protocol: 1,
      channel: 'beta',
      update: { status: 'downloading', version: '1.3.0', percent: 41 },
    });
  });
});

describe('the update link', () => {
  it('reports to its engine at once, every 5 seconds and on every change', async () => {
    const world = createWorld({ platform: 'linux', answer: answerOnce() });
    await run(world, (updater) =>
      Effect.gen(function* () {
        yield* TestClock.adjust('5 seconds');
        yield* flush;
        yield* updater.applyChannel('beta');
      })
    );
    expect(listReports(world).map((report) => report.channel)).toEqual(['stable', 'stable', 'beta']);
    expect(listReports(world)[0]).toEqual({
      version: '1.2.0',
      protocol: 1,
      channel: 'stable',
      update: { status: 'none' },
    });
  });

  it('reports each state the updater moves through', async () => {
    const world = createWorld({ answer: answerOnce() });
    await run(
      world,
      () =>
        emit(
          world,
          { _tag: 'Available', version: '1.3.0' },
          { _tag: 'Downloaded', version: '1.3.0' },
          { _tag: 'Staged' }
        ),
      true
    );
    expect(listReports(world).map((report) => report.update)).toContainEqual({
      status: 'ready',
      version: '1.3.0',
    });
    expect(listReports(world).at(-1)?.update).toEqual({ status: 'ready', version: '1.3.0' });
  });

  it('switches channel and checks for updates when another device asks', async () => {
    const world = createWorld({
      answer: answerOnce({ kind: 'channel', channel: 'beta' }, { kind: 'check' }),
    });
    const snapshot = await run(world, (updater) => updater.snapshot);
    expect(snapshot.channel).toBe('beta');
    expect(JSON.parse(world.files.get(PREFS) ?? '{}')).toMatchObject({ updateChannel: 'beta' });
    expect(world.checks).toBe(2);
    expect(world.dialogs).toEqual([]);
  });

  it('installs a ready update when another device asks', async () => {
    let ready = false;
    const world = createWorld({
      answer: (path) => answerJson({ requests: ready && path === REPORT ? [{ kind: 'install' }] : [] }),
    });
    const state = await run(
      world,
      (updater) =>
        Effect.gen(function* () {
          yield* emit(
            world,
            { _tag: 'Available', version: '1.3.0' },
            { _tag: 'Downloaded', version: '1.3.0' },
            { _tag: 'Staged' }
          );
          ready = true;
          yield* TestClock.adjust('5 seconds');
          yield* flush;
          ready = false;
          return (yield* updater.snapshot).state;
        }),
      true
    );
    expect(world.installs).toBe(1);
    expect(state).toEqual({ status: 'installing', version: '1.3.0' });
  });

  it('answers the go-back offer when another device asks', async () => {
    const world = createWorld({
      version: '1.3.0-beta.1',
      onCheck: () => ({ events: [{ _tag: 'NotAvailable', version: '1.2.0' }] }),
    });
    world.files.set(PREFS, JSON.stringify({ updateChannel: 'stable' }));
    let offered = false;
    world.answer = (path) =>
      answerJson({ requests: offered && path === REPORT ? [{ kind: 'downgrade', accept: false }] : [] });
    const state = await run(
      world,
      (updater) =>
        Effect.gen(function* () {
          offered = (yield* updater.snapshot).state.status === 'downgrade';
          yield* TestClock.adjust('5 seconds');
          yield* flush;
          offered = false;
          return (yield* updater.snapshot).state;
        }),
      true
    );
    expect(state).toEqual({ status: 'current', latest: '1.2.0' });
    expect(JSON.parse(world.files.get(PREFS) ?? '{}').keptVersion).toBe('1.3.0-beta.1');
  });

  it('keeps reporting while the engine does not answer', async () => {
    const world = createWorld();
    await run(world, () =>
      Effect.gen(function* () {
        yield* TestClock.adjust('5 seconds');
        yield* flush;
        yield* TestClock.adjust('5 seconds');
      })
    );
    expect(world.requests.filter((path) => path === REPORT)).toHaveLength(3);
  });
});
