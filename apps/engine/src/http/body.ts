import { DomainError } from '@shinsa/core';

export type JsonObject = Record<string, unknown>;

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function readJson(request: Request, limit = MAX_BODY_BYTES): Promise<unknown> {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > limit) {
    throw new DomainError(
      'body_too_large',
      `The request body is over ${Math.floor(limit / 1024 / 1024)} MB.`
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DomainError('body_invalid', 'The request body is not valid JSON.');
  }
}

export async function readJsonObject(request: Request, limit = MAX_BODY_BYTES): Promise<JsonObject> {
  const body = await readJson(request, limit);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError('body_invalid', 'The request body must be an object.');
  }
  return body as JsonObject;
}
