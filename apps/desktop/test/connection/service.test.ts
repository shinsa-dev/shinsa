import { describe, expect, it } from 'bun:test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { Connection } from '../../src/connection/service.ts';
import { EngineActions } from '../../src/engine-actions/service.ts';
import type { EngineAction } from '../../src/engine/schema.ts';
import { LOGIN_ITEMS_URL, PRIVACY_URL } from '../../src/engine/schema.ts';
import {
  answerJson,
  type ConnectedServices,
  createWorld,
  type DesktopWorld,
  flush,
  runConnected,
} from '../support/desktop.ts';

const SERVER = 'load http://127.0.0.1:7446/';

const WAITING_FOR_DEV = 'waiting Waiting for Shinsa';

const STARTING = 'waiting Starting Shinsa';

const STOPPED = 'waiting Shinsa’s engine is not running';

const QUEUE = {
  briefing: null,
  decisions: [
    { taskId: 't1', handle: 'LOC-4', title: 'Fix the badge', label: 'Review', kind: 'review', url: 'x' },
  ],
  working: [],
};

function createEngine(up: { value: boolean }, overrides: Partial<DesktopWorld> = {}) {
  return createWorld({
    answer: (path) => {
      if (!up.value) return 'refuse';
      if (path === '/api/queue') return answerJson(QUEUE);
      return answerJson({ ok: true, version: '1.2.0', working: 1 });
    },
    ...overrides,
  });
}

function connect(world: DesktopWorld, body: Effect.Effect<void, never, ConnectedServices> = Effect.void) {
  return runConnected(
    world,
    Effect.gen(function* () {
      const connection = yield* Connection;
      const started = yield* Effect.forkChild(connection.start);
      yield* flush;
      yield* body;
      yield* flush;
      yield* Fiber.interrupt(started);
    })
  );
}

function advance(duration: `${number} seconds`) {
  return Effect.andThen(TestClock.adjust(duration), flush);
}

function request(action: EngineAction) {
  return Effect.andThen(
    EngineActions.use((actions) => actions.request(action)),
    flush
  );
}

describe('connecting to the engine', () => {
  it('opens Shinsa with the health check sent at start, then fills the tray and the About panel', async () => {
    const world = createEngine({ value: true });
    await connect(world);
    expect(world.window).toEqual([SERVER]);
    expect(world.requests).toEqual(['/api/health', '/api/queue']);
    expect(world.tray.at(-1)?.title).toBe('1');
    expect(world.about.at(-1)?.credits).toBe('Shinsa 1.2.0 at http://127.0.0.1:7446');
  });

  it('waits for the dev servers every 2 s and opens Shinsa once they answer', async () => {
    const up = { value: false };
    const world = createEngine(up, { packaged: false, env: { SHINSA_URL: 'http://127.0.0.1:5180' } });
    await connect(
      world,
      Effect.gen(function* () {
        yield* advance('2 seconds');
        yield* advance('2 seconds');
        up.value = true;
        yield* advance('2 seconds');
      })
    );
    expect(world.window).toEqual([WAITING_FOR_DEV, 'load http://127.0.0.1:5180/']);
    expect(world.shell.filter((entry) => entry === 'badge ')).toHaveLength(1);
  });

  it('shows why the engine is not running and opens Shinsa once a check finds it', async () => {
    const up = { value: false };
    const world = createEngine(up);
    await connect(
      world,
      Effect.gen(function* () {
        yield* advance('40 seconds');
        expect(world.window).toEqual([STARTING, STOPPED]);
        up.value = true;
        yield* advance('5 seconds');
      })
    );
    expect(world.window).toEqual([STARTING, STOPPED, SERVER]);
  });
});

describe('watching the engine', () => {
  it('keeps the window after two missed checks and shows the status page after three', async () => {
    const up = { value: true };
    const world = createEngine(up, { packaged: false });
    await connect(
      world,
      Effect.gen(function* () {
        up.value = false;
        yield* advance('5 seconds');
        yield* advance('5 seconds');
        expect(world.window).toEqual(['load http://127.0.0.1:5181/']);
        up.value = true;
        yield* advance('5 seconds');
        up.value = false;
        yield* advance('5 seconds');
        yield* advance('5 seconds');
        yield* advance('5 seconds');
      })
    );
    expect(world.window).toEqual(['load http://127.0.0.1:5181/', WAITING_FOR_DEV]);
    expect(world.tray.at(-1)?.tooltip).toBe('The engine is not answering');
  });

  it('checks a status page every 5 s while the engine stays down', async () => {
    const world = createEngine({ value: false });
    const counts: number[] = [];
    const countChecks = Effect.sync(() => {
      counts.push(world.requests.length);
    });
    await connect(
      world,
      Effect.gen(function* () {
        yield* advance('40 seconds');
        yield* countChecks;
        yield* advance('5 seconds');
        yield* countChecks;
      })
    );
    expect(counts[1]! - counts[0]!).toBe(1);
    expect(world.window).toEqual([STARTING, STOPPED]);
  });
});

describe('the status page’s buttons', () => {
  it('opens System Settings and copies the engine’s details', async () => {
    const world = createEngine({ value: true });
    world.files.set('/Users/me/.config/shinsa/data/engine.log', 'listening\n');
    await connect(
      world,
      Effect.gen(function* () {
        yield* request('open-login-items');
        yield* request('open-privacy');
        yield* request('copy-details');
      })
    );
    expect(world.shell.filter((entry) => !entry.startsWith('badge'))).toEqual([
      `open ${LOGIN_ITEMS_URL}`,
      `open ${PRIVACY_URL}`,
      'copy Engine log: /Users/me/.config/shinsa/data/engine.log\n\nlistening',
    ]);
  });

  it('restarts the engine and opens Shinsa again', async () => {
    const world = createEngine({ value: true });
    await connect(world, request('restart'));
    expect(world.launchctl).toContainEqual(['kickstart', '-k', 'gui/501/studio.overclock.shinsa.engine']);
    expect(world.window).toEqual([SERVER, STARTING, SERVER]);
  });

  it('tries again once at a time', async () => {
    const up = { value: false };
    const world = createEngine(up, { packaged: false });
    await connect(
      world,
      Effect.gen(function* () {
        yield* request('retry');
        yield* request('retry');
        up.value = true;
        yield* advance('2 seconds');
      })
    );
    expect(world.window).toEqual([WAITING_FOR_DEV, 'load http://127.0.0.1:5181/']);
    expect(world.requests.filter((path) => path === '/api/health')).toHaveLength(3);
  });
});
