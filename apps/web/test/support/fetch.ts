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

export async function readFetchRequest(input: RequestInfo | URL, init?: RequestInit): Promise<FetchRequest> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), location.href);
  const path = url.origin === location.origin ? `${url.pathname}${url.search}` : url.href;
  let text = readText(init?.body);
  if (request) text = await request.text();
  return {
    path,
    method: request?.method ?? init?.method ?? 'GET',
    headers: new Headers(request?.headers ?? init?.headers),
    body: text ? JSON.parse(text) : null,
  };
}
