import { REMOTE_PATHS } from '@shinsa/core';
import { serializeRemoteFailure } from '@shinsa/core/remote/errors';
import { Effect } from 'effect';
import { HttpEffect, HttpServerResponse } from 'effect/http';

export const NOINDEX = 'noindex, nofollow, noarchive';

interface RedirectOptions {
  readonly status?: 302 | 303;
  readonly cookies?: ReadonlyArray<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

export function respondRedirect(location: string, options: RedirectOptions = {}) {
  const headers = new Headers({ location, 'cache-control': 'no-store', ...options.headers });
  for (const cookie of options.cookies ?? []) headers.append('set-cookie', cookie);
  return HttpServerResponse.raw(new Response(null, { status: options.status ?? 302, headers }));
}

export function respondSignInRedirect(origin: string, url: URL) {
  const signIn = new URL(REMOTE_PATHS.signIn, origin);
  signIn.searchParams.set('return', `${url.pathname}${url.search}`);
  return respondRedirect(signIn.href);
}

export function resolveFailureCode(failure: { readonly _tag: string; readonly message: string }) {
  return serializeRemoteFailure(failure).body.error.code;
}

export function respondFailure(failure: { readonly _tag: string; readonly message: string }) {
  const { status, body } = serializeRemoteFailure(failure);
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe(body, { status, headers: { 'cache-control': 'no-store' } })
  );
}

interface TextOptions {
  readonly status?: number;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export function respondText(text: string, options: TextOptions = {}) {
  return HttpServerResponse.text(text, {
    status: options.status ?? 200,
    contentType: options.contentType ?? 'text/plain',
    headers: options.headers ?? {},
  });
}

export const appendResponseHeader = (name: string, value: string) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(HttpServerResponse.setHeader(response, name, value))
  );
