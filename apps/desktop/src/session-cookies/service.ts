import { Context, type Effect } from 'effect';
import type { CookieWriteFailed, SessionCookie } from './schema.ts';

export class SessionCookies extends Context.Service<
  SessionCookies,
  { write(cookie: SessionCookie): Effect.Effect<void, CookieWriteFailed> }
>()('shinsa/desktop/session-cookies/SessionCookies') {}
