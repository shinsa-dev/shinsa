import { Effect, Layer, Queue, Stream } from 'effect';
import { Notification } from 'electron';
import { NativeNotices } from '../native-notices/service.ts';
import type { NoticeEvent } from '../notifications/schema.ts';

export const NativeNoticesLive = Layer.sync(NativeNotices, () =>
  NativeNotices.of({
    supported: Notification.isSupported(),
    show: Effect.fn('NativeNotices.show')(function* (notice) {
      const events = yield* Queue.unbounded<NoticeEvent>();
      const notification = new Notification({ title: notice.title, body: notice.body, silent: true });
      const emit = (event: NoticeEvent) => () => {
        Queue.offerUnsafe(events, event);
      };
      notification.on('click', emit('click'));
      notification.on('close', emit('close'));
      notification.on('failed', emit('failed'));
      notification.show();
      return { close: Effect.sync(() => notification.close()), events: Stream.fromQueue(events) };
    }),
  })
);
