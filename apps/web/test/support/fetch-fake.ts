import { type FetchRequest, readFetchRequest } from './fetch.ts';
import { addTeardown } from './teardown.ts';

export function answerFetch(answer: (request: FetchRequest) => Response | Promise<Response>) {
  const realFetch = globalThis.fetch;
  const requests: FetchRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = await readFetchRequest(input, init);
    requests.push(request);
    return answer(request);
  }) as typeof fetch;
  addTeardown(() => {
    globalThis.fetch = realFetch;
  });
  return requests;
}
