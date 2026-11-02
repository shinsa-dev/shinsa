import { Context, Effect, Layer, Ref, Stream } from 'effect';
import { CHANNELS } from '../bridge/schema.ts';
import { NativeNotices } from '../native-notices/service.ts';
import { AppWindow } from '../window/service.ts';
import type { DesktopNotice, NativeNotice, NoticeEvent } from './schema.ts';

export class Notifications extends Context.Service<
  Notifications,
  { show(notice: DesktopNotice): Effect.Effect<void> }
>()('shinsa/desktop/notifications/Notifications') {
  static readonly layer = Layer.effect(
    Notifications,
    Effect.gen(function* () {
      const native = yield* NativeNotices;
      const window = yield* AppWindow;
      const scope = yield* Effect.scope;
      const shown = yield* Ref.make(new Map<string, NativeNotice>());
      const forget = (tag: string, notice: NativeNotice) =>
        Ref.update(shown, (current) => {
          if (current.get(tag) !== notice) return current;
          const next = new Map(current);
          next.delete(tag);
          return next;
        });
      const answer = Effect.fn('Notifications.answer')(function* (
        request: DesktopNotice,
        notice: NativeNotice,
        event: NoticeEvent
      ) {
        yield* forget(request.tag, notice);
        if (event === 'click') {
          if (request.path) yield* window.open(request.path);
          return yield* window.show;
        }
        if (event === 'failed' && (yield* window.page) === 'app')
          yield* window.sendToPage(CHANNELS.notifyFailed);
      });
      const show = Effect.fn('Notifications.show')(function* (request: DesktopNotice) {
        if (!native.supported) return;
        const previous = (yield* Ref.get(shown)).get(request.tag);
        if (previous) yield* previous.close;
        const notice = yield* native.show(request);
        yield* Ref.update(shown, (current) => new Map(current).set(request.tag, notice));
        yield* Effect.forkIn(
          Stream.runForEach(Stream.take(notice.events, 1), (event) => answer(request, notice, event)),
          scope,
          { startImmediately: true }
        );
      });
      return Notifications.of({ show });
    })
  );
}
