export interface FetchRequest {
  path: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function readText(body: BodyInit | null | undefined) {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return null;
}

function readPath(url: URL) {
  return url.origin === location.origin ? `${url.pathname}${url.search}` : url.href;
}

export function readFetchCall(input: RequestInfo | URL, init?: RequestInit): FetchRequest {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const text = readText(init?.body);
  return {
    path: readPath(url),
    method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    headers: new Headers(input instanceof Request ? input.headers : init?.headers),
    body: text ? JSON.parse(text) : null,
  };
}

export async function readFetchRequest(input: RequestInfo | URL, init?: RequestInit): Promise<FetchRequest> {
  const call = readFetchCall(input, init);
  if (!(input instanceof Request)) return call;
  const text = await input.text();
  return { ...call, body: text ? JSON.parse(text) : null };
}
