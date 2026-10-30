import { isRelayedRequest, type RelayClients, relayRequest } from '@/lib/remote/relay.ts';

interface ExtendableEventLike extends Event {
  waitUntil: (work: Promise<unknown>) => void;
}

interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  clientId: string;
  respondWith: (answer: Promise<Response>) => void;
}

interface ServiceWorkerScope {
  location: Location;
  clients: RelayClients & { claim: () => Promise<void> };
  skipWaiting: () => Promise<void>;
  addEventListener: (type: string, listener: (event: FetchEventLike) => void) => void;
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
