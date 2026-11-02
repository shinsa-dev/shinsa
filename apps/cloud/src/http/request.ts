import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/http';

export const CurrentUrl = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => new URL(request.originalUrl)
);

export function readCookie(request: HttpServerRequest.HttpServerRequest, name: string) {
  return request.cookies[name] ?? null;
}
