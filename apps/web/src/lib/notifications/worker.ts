import { Effect, Option, Predicate, Schema } from 'effect';
import {
  NOTIFICATION_FAILED,
  NOTIFICATION_OPEN,
  NotificationData,
  NotificationFailed,
  NotificationOpen,
  type NotificationClients,
  type NotificationWorker,
} from './schema.ts';

const decodeNotificationData = Schema.decodeUnknownOption(NotificationData);

const isNotificationOpen = Schema.is(NotificationOpen);

function enterClients<A>(step: () => Promise<A>) {
  return Effect.tryPromise({
    try: step,
    catch: (error) =>
      new NotificationFailed({ message: Predicate.isError(error) ? error.message : NOTIFICATION_FAILED }),
  });
}

export function readNotificationPath(data: unknown) {
  return Option.getOrNull(Option.map(decodeNotificationData(data), (notice) => notice.path));
}

export const openNotificationTarget = Effect.fn('NotificationWorker.openTarget')(function* (
  path: string | null,
  home: string,
  clients: NotificationClients
) {
  const windows = yield* enterClients(() => clients.matchAll({ type: 'window' }));
  const client = windows.find((candidate) => candidate.focused) ?? windows[0];
  if (!client) {
    yield* enterClients(() => clients.openWindow(path ?? home));
    return;
  }
  yield* enterClients(() => client.focus());
  if (path) client.postMessage({ type: NOTIFICATION_OPEN, path });
});

export function serveNotificationOpens(
  target: Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>,
  open: (path: string) => void
) {
  const listener = (event: MessageEvent) => {
    if (isNotificationOpen(event.data)) open(event.data.path);
  };
  target.addEventListener('message', listener as EventListener);
  return () => target.removeEventListener('message', listener as EventListener);
}

export function selectNotificationWorker(): NotificationWorker | null {
  const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  return container?.controller ? container : null;
}
