import { Context, Effect, Layer, Ref, Stream } from 'effect';
import { NativeTray } from '../native-tray/service.ts';
import type { ServerHealth } from '../server/schema.ts';
import { DesktopShell } from '../shell/service.ts';
import { EngineSource } from '../source/service.ts';
import { resolveSourceChoice } from '../source/source.ts';
import { AppWindow } from '../window/service.ts';
import { describeTrayStatus, listTrayItems, resolveTrayTitle } from './menu.ts';
import type { TrayClick, TrayQueue } from './schema.ts';

export class StatusTray extends Context.Service<
  StatusTray,
  {
    update(health: ServerHealth | null, queue: TrayQueue | null): Effect.Effect<void>;
    showCount(text: string): Effect.Effect<void>;
  }
>()('shinsa/desktop/tray/StatusTray') {
  static readonly layer = Layer.effect(
    StatusTray,
    Effect.gen(function* () {
      const native = yield* NativeTray;
      const shell = yield* DesktopShell;
      const window = yield* AppWindow;
      const source = yield* EngineSource;
      const scope = yield* Effect.scope;
      const shown = yield* Ref.make('');
      const pageCount = yield* Ref.make('');
      const last = yield* Ref.make<{ health: ServerHealth | null; queue: TrayQueue | null }>({
        health: null,
        queue: null,
      });
      const update = Effect.fn('StatusTray.update')(function* (
        health: ServerHealth | null,
        queue: TrayQueue | null
      ) {
        yield* Ref.set(last, { health, queue });
        const current = yield* source.current;
        const items = listTrayItems(health, queue, current);
        const tasks = health ? queue : null;
        const title =
          current.kind === 'cloud' ? (health ? yield* Ref.get(pageCount) : '') : resolveTrayTitle(tasks);
        const key = JSON.stringify({ items, title });
        if ((yield* Ref.getAndSet(shown, key)) === key) return;
        yield* native.show({ title, tooltip: describeTrayStatus(health, tasks, current), items });
      });
      const redraw = Effect.flatMap(Ref.get(last), (shownState) =>
        update(shownState.health, shownState.queue)
      );
      const showCount = Effect.fn('StatusTray.showCount')(function* (text: string) {
        yield* Ref.set(pageCount, text);
        yield* redraw;
      });
      const answer = Effect.fn('StatusTray.answer')(function* (click: TrayClick) {
        if (click.kind === 'task') {
          yield* window.show;
          return yield* window.open(click.path);
        }
        if (click.kind === 'source') {
          const step = yield* source.use(resolveSourceChoice(yield* source.current, click.choice));
          if (step !== 'reload') return;
          yield* window.show;
          return yield* window.reload;
        }
        if (click.action === 'open') return yield* window.show;
        yield* shell.quit;
      });
      yield* update(null, null);
      yield* Effect.forkIn(
        Stream.runForEach(source.changes, () => redraw),
        scope,
        { startImmediately: true }
      );
      yield* Effect.forkIn(Stream.runForEach(native.clicks, answer), scope, { startImmediately: true });
      return StatusTray.of({ update, showCount });
    })
  );
}
