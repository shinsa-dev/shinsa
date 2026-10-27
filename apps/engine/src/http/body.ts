import { DomainError } from '@shinsa/core';

export type JsonObject = Record<string, unknown>;

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError('body_invalid', 'The request body is not valid JSON.');
  }
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError('body_invalid', 'The request body must be an object.');
  }
  return body as JsonObject;
}
