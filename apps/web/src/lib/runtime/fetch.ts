import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';

export type RequestFetch = (request: Request) => Promise<Response>;

export function sendThrough(send: RequestFetch) {
  const fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => send(new Request(input, init)),
    { preconnect: globalThis.fetch.preconnect }
  );
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, FetchHttpClient.Fetch, fetch);
}
