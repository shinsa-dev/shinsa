export const NOTIFICATION_OPEN = 'shinsa-notification-open';

interface NotificationOpen {
  type: typeof NOTIFICATION_OPEN;
  path: string;
}

interface WindowClientLike {
  focused: boolean;
  focus: () => Promise<unknown>;
  postMessage: (message: NotificationOpen) => void;
}

export interface NotificationClients {
  matchAll: (options: { type: 'window' }) => Promise<readonly WindowClientLike[]>;
  openWindow: (url: string) => Promise<unknown>;
}

export type NotificationWorker = Pick<ServiceWorkerContainer, 'controller' | 'ready'>;

function isAppPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

export function readNotificationPath(data: unknown) {
  const path = typeof data === 'object' && data !== null ? Reflect.get(data, 'path') : null;
  return isAppPath(path) ? path : null;
}

export async function openNotificationTarget(
  path: string | null,
  home: string,
  clients: NotificationClients
) {
  const windows = await clients.matchAll({ type: 'window' });
  const client = windows.find((candidate) => candidate.focused) ?? windows[0];
  if (!client) {
    await clients.openWindow(path ?? home);
    return;
  }
  await client.focus();
  if (path) client.postMessage({ type: NOTIFICATION_OPEN, path });
}

function isNotificationOpen(data: unknown): data is NotificationOpen {
  return (
    typeof data === 'object' &&
    data !== null &&
    Reflect.get(data, 'type') === NOTIFICATION_OPEN &&
    isAppPath(Reflect.get(data, 'path'))
  );
}

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
