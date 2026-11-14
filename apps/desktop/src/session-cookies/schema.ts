import { Schema } from 'effect';

export interface SessionCookie {
  readonly url: string;
  readonly name: string;
  readonly value: string;
  readonly expiresAt: number;
}

export class CookieWriteFailed extends Schema.TaggedError<
  CookieWriteFailed,
  { readonly brand: unique symbol }
>()('CookieWriteFailed', { cookie: Schema.String, message: Schema.String }) {}
