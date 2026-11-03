import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { CHANNELS } from '../../src/bridge/schema.ts';
import type { DesktopNotice, NoticeEvent } from '../../src/notifications/schema.ts';
import { Notifications } from '../../src/notifications/service.ts';
import { AppWindow } from '../../src/window/service.ts';
import { createWorld, type DesktopWorld, flush, offer, runDesktop } from '../support/desktop.ts';

const REVIEW: DesktopNotice = {
  title: 'Needs you',
  body: 'Review LOC-4',
  tag: 'LOC-4',
  path: '/tasks/LOC-4',
};

function run(
  world: DesktopWorld,
  body: (notifications: Notifications['Service'], window: AppWindow['Service']) => Effect.Effect<void>
) {
  return runDesktop(
    world,
    Effect.gen(function* () {
      const notifications = yield* Notifications;
      const window = yield* AppWindow;
      yield* flush;
      yield* body(notifications, window);
      yield* flush;
    })
  );
}

function answer(world: DesktopWorld, index: number, event: NoticeEvent) {
  return offer(world.noticeEvents[index] ?? null, event);
}

describe('notifications', () => {
  it('replaces a notification with the same tag and opens its task on click', async () => {
    const world = createWorld();
    await run(world, (notifications, window) =>
      Effect.gen(function* () {
        yield* window.showServerPage;
        yield* notifications.show(REVIEW);
        yield* notifications.show({ ...REVIEW, body: 'Review LOC-4 again' });
        yield* notifications.show({ ...REVIEW, tag: 'home', path: null });
        yield* answer(world, 1, 'click');
        yield* answer(world, 2, 'click');
      })
    );
    expect(world.shell).toEqual(['close LOC-4']);
    expect(world.sent).toEqual([[CHANNELS.navigate, '/tasks/LOC-4']]);
    expect(world.window.filter((call) => call === 'show')).toHaveLength(2);
  });

  it('forgets a closed notification, so the next one closes nothing', async () => {
    const world = createWorld();
    await run(world, (notifications) =>
      Effect.gen(function* () {
        yield* notifications.show(REVIEW);
        yield* answer(world, 0, 'close');
        yield* notifications.show(REVIEW);
      })
    );
    expect(world.shell).toEqual([]);
    expect(world.notices).toHaveLength(2);
  });

  it('tells the page when macOS refuses one, only while the page shows', async () => {
    const world = createWorld();
    await run(world, (notifications, window) =>
      Effect.gen(function* () {
        yield* notifications.show(REVIEW);
        yield* answer(world, 0, 'failed');
        yield* window.showServerPage;
        yield* notifications.show(REVIEW);
        yield* answer(world, 1, 'failed');
      })
    );
    expect(world.sent).toEqual([[CHANNELS.notifyFailed, undefined]]);
  });

  it('shows nothing where notifications are not supported', async () => {
    const world = createWorld({ noticesSupported: false });
    await run(world, (notifications) => notifications.show(REVIEW));
    expect(world.notices).toEqual([]);
  });
});
