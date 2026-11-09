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
  Schema.Struct({
    id: Schema.Number,
    method: Schema.String,
    sessionId: Schema.optional(Schema.String),
    params: Schema.optional(Schema.Unknown),
  })
);

export const CdpMessage = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(Schema.Number),
    method: Schema.optional(Schema.String),
    sessionId: Schema.optional(Schema.String),
    params: Schema.optional(Schema.Unknown),
    result: Schema.optional(Schema.Unknown),
  })
);
export type CdpMessage = typeof CdpMessage.Type;

export const TargetInfo = Schema.Struct({
  targetId: Schema.String,
  type: Schema.String,
  openerId: Schema.optional(Schema.String),
});
export type TargetInfo = typeof TargetInfo.Type;

export const AttachedToTarget = Schema.Struct({
  sessionId: Schema.String,
  targetInfo: TargetInfo,
  waitingForDebugger: Schema.optional(Schema.Boolean),
});

export const TargetEventParams = Schema.Struct({
  targetId: Schema.optional(Schema.String),
  targetInfo: Schema.optional(TargetInfo),
});

export const CreatedTarget = Schema.Struct({ targetId: Schema.String });

export const TargetList = Schema.Struct({ targetInfos: Schema.Array(Schema.Unknown) });

export interface AgentMessage {
  readonly forward: string | null;
  readonly reply: string | null;
}

export interface BrowserMessage {
  readonly toAgent: ReadonlyArray<string>;
  readonly toBrowser: ReadonlyArray<string>;
}

export interface HeldPage {
  readonly targetId: string;
  readonly sessionId: string;
  readonly waiting: boolean;
  readonly messages: string[];
}

export interface TargetFilter {
  fromAgent(text: string): AgentMessage;
  fromBrowser(text: string): BrowserMessage;
}

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

export const PAGE_TARGET = 'page';

export const TARGET_EVENTS: ReadonlySet<string> = new Set([
  'Target.targetCreated',
  'Target.targetInfoChanged',
  'Target.targetDestroyed',
  'Target.detachedFromTarget',
]);

export const FOREIGN_TARGET_METHODS: ReadonlySet<string> = new Set([
  'Target.attachToTarget',
  'Target.activateTarget',
  'Target.closeTarget',
]);

export const FIRST_PROXY_COMMAND_ID = 1_000_000_000;

export const FOREIGN_PAGE_MESSAGE =
  'This page belongs to another agent of the project. Open a page of your own with a new tab.';

export const KEY_REFUSED_MESSAGE =
  'This browser key is not valid. It works only while the run it was made for is going.';

export const NOT_LOCAL_MESSAGE = "Only this Mac can reach the project's browser.";

export const KEY_REVOKED_REASON = 'The run this browser key was made for has ended.';

export const BROWSER_GONE_REASON = "The project's browser stopped.";

export const CLOSE_POLICY = 1008;

export const CLOSE_GOING_AWAY = 1001;

export const CDP_SERVER_ERROR = -32000;
