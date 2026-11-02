import { Context, Effect, Layer, Ref, Stream } from 'effect';
import { NativeTray } from '../native-tray/service.ts';
import type { ServerHealth } from '../server/schema.ts';
import { DesktopShell } from '../shell/service.ts';
import { AppWindow } from '../window/service.ts';
import { describeTrayStatus, listTrayItems, resolveTrayTitle } from './menu.ts';
import type { TrayClick, TrayQueue } from './schema.ts';

export class StatusTray extends Context.Service<
  StatusTray,
  { update(health: ServerHealth | null, queue: TrayQueue | null): Effect.Effect<void> }
>()('shinsa/desktop/tray/StatusTray') {
  static readonly layer = Layer.effect(
    StatusTray,
    Effect.gen(function* () {
      const native = yield* NativeTray;
      const shell = yield* DesktopShell;
      const window = yield* AppWindow;
      const scope = yield* Effect.scope;
      const shown = yield* Ref.make('');
      const update = Effect.fn('StatusTray.update')(function* (
        health: ServerHealth | null,
        queue: TrayQueue | null
      ) {
        const items = listTrayItems(health, queue);
        const tasks = health ? queue : null;
        const title = resolveTrayTitle(tasks);
        const key = JSON.stringify({ items, title });
        if ((yield* Ref.getAndSet(shown, key)) === key) return;
        yield* native.show({ title, tooltip: describeTrayStatus(health, tasks), items });
      });
      const answer = Effect.fn('StatusTray.answer')(function* (click: TrayClick) {
        if (click.kind === 'task') {
          yield* window.show;
          return yield* window.open(click.path);
        }
        if (click.action === 'open') return yield* window.show;
        yield* shell.quit;
      });
      yield* update(null, null);
      yield* Effect.forkIn(Stream.runForEach(native.clicks, answer), scope, { startImmediately: true });
      return StatusTray.of({ update });
    })
  );
}
