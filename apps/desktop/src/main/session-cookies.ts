import { Effect, Layer } from 'effect';
import { session } from 'electron';
import { CookieWriteFailed } from '../session-cookies/schema.ts';
import { SessionCookies } from '../session-cookies/service.ts';

export const SessionCookiesLive = Layer.succeed(
  SessionCookies,
  SessionCookies.of({
    write: (cookie) =>
      Effect.tryPromise({
        try: () =>
          session.defaultSession.cookies.set({
            url: cookie.url,
            name: cookie.name,
            value: cookie.value,
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            expirationDate: cookie.expiresAt,
          }),
        catch: (error) => new CookieWriteFailed({ cookie: cookie.name, message: String(error) }),
      }),
  })
);
