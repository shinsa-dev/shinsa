import { Schema, type Scope } from 'effect';
import type { BrowserProfile } from '../host/schema.ts';

export const BrowserKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)).pipe(
  Schema.brand('BrowserKey')
);
export type BrowserKey = typeof BrowserKey.Type;

export class BrowserKeyRefused extends Schema.TaggedError<
  BrowserKeyRefused,
  { readonly brand: unique symbol }
>()('BrowserKeyRefused', { message: Schema.String }) {}

export const CdpCommand = Schema.fromJsonString(
  Schema.Struct({ id: Schema.Number, method: Schema.String, sessionId: Schema.optional(Schema.String) })
);

export interface BrowserPeer {
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
}

export interface BrowserRelay {
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface BrowserAdmission {
  readonly key: BrowserKey;
  readonly profile: BrowserProfile;
  readonly webSocketUrl: string;
  readonly scope: Scope.Closeable;
}

export interface LiveRelay {
  end(code: number, reason: string): void;
}

export interface IssuedKey {
  readonly profile: BrowserProfile;
  readonly relays: ReadonlySet<LiveRelay>;
}

export const BROWSER_KEY_BYTES = 32;

export const BROWSER_CDP_PATH = '/browser/cdp/';

export const BROWSER_UNAVAILABLE = { code: 'browser_unavailable', status: 503 } as const;

export const REFUSED_METHODS: ReadonlySet<string> = new Set(['Browser.close', 'Browser.crash']);

export const REFUSED_METHOD_MESSAGE =
  'This browser is shared by every agent of the project, so it stays open. Close your own pages instead.';

export const KEY_REFUSED_MESSAGE =
  'This browser key is not valid. It works only while the run it was made for is going.';

export const NOT_LOCAL_MESSAGE = "Only this Mac can reach the project's browser.";

export const KEY_REVOKED_REASON = 'The run this browser key was made for has ended.';

export const BROWSER_GONE_REASON = "The project's browser stopped.";

export const CLOSE_POLICY = 1008;

export const CLOSE_GOING_AWAY = 1001;

export const CDP_SERVER_ERROR = -32000;
