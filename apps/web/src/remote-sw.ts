import {
  type NotificationClients,
  openNotificationTarget,
  readNotificationPath,
} from '@/lib/notifications/worker.ts';
import { isRelayedRequest, type RelayClients, relayRequest } from '@/lib/remote/relay.ts';

interface ExtendableEventLike extends Event {
  waitUntil: (work: Promise<unknown>) => void;
}

interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  clientId: string;
  respondWith: (answer: Promise<Response>) => void;
}

interface NotificationClickEventLike extends ExtendableEventLike {
  notification: { data: unknown; close: () => void };
}

interface ServiceWorkerScope {
  location: Location;
  registration: { scope: string };
  clients: RelayClients & NotificationClients & { claim: () => Promise<void> };
  skipWaiting: () => Promise<void>;
  addEventListener: {
    (type: 'notificationclick', listener: (event: NotificationClickEventLike) => void): void;
    (type: string, listener: (event: FetchEventLike) => void): void;
  };
}

const worker = globalThis as unknown as ServiceWorkerScope;

worker.addEventListener('install', () => {
  void worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener('fetch', (event) => {
  if (!isRelayedRequest(event.request, worker.location.origin)) return;
  event.respondWith(relayRequest(event.request, event.clientId, worker.clients));
});

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = readNotificationPath(event.notification.data);
  event.waitUntil(openNotificationTarget(path, worker.registration.scope, worker.clients));
});
