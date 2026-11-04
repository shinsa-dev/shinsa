import { Duration, type Effect, Schedule, Schema, type Scope, type Stream } from 'effect';

export class ChromiumNotFound extends Schema.TaggedError<
  ChromiumNotFound,
  { readonly brand: unique symbol }
>()('ChromiumNotFound', { message: Schema.String }) {}

export class ChromiumLaunchFailed extends Schema.TaggedError<
  ChromiumLaunchFailed,
  { readonly brand: unique symbol }
>()('ChromiumLaunchFailed', { message: Schema.String }) {}

export class ChromiumLaunchTimeout extends Schema.TaggedError<
  ChromiumLaunchTimeout,
  { readonly brand: unique symbol }
>()('ChromiumLaunchTimeout', { message: Schema.String }) {}

export class TargetsUnavailable extends Schema.TaggedError<
  TargetsUnavailable,
  { readonly brand: unique symbol }
>()('TargetsUnavailable', { message: Schema.String }) {}

export class PageNotFound extends Schema.TaggedError<PageNotFound, { readonly brand: unique symbol }>()(
  'PageNotFound',
  { message: Schema.String }
) {}

export class CdpConnectFailed extends Schema.TaggedError<
  CdpConnectFailed,
  { readonly brand: unique symbol }
>()('CdpConnectFailed', { message: Schema.String }) {}

export class CdpCommandFailed extends Schema.TaggedError<
  CdpCommandFailed,
  { readonly brand: unique symbol }
>()('CdpCommandFailed', { method: Schema.String, message: Schema.String }) {}

export class CdpEvaluateFailed extends Schema.TaggedError<
  CdpEvaluateFailed,
  { readonly brand: unique symbol }
>()('CdpEvaluateFailed', { message: Schema.String }) {}

export const Target = Schema.Struct({
  type: Schema.String,
  url: Schema.String,
  webSocketDebuggerUrl: Schema.String,
});
export type Target = typeof Target.Type;

export const Targets = Schema.Array(Target);

const CdpMessage = Schema.Struct({
  id: Schema.optionalKey(Schema.Number),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
});

export const CdpMessageText = Schema.fromJsonString(CdpMessage);

export const EvaluateReply = Schema.Struct({
  result: Schema.Struct({ value: Schema.optionalKey(Schema.Unknown) }),
  exceptionDetails: Schema.optionalKey(
    Schema.Struct({
      text: Schema.optionalKey(Schema.String),
      exception: Schema.optionalKey(Schema.Struct({ description: Schema.optionalKey(Schema.String) })),
    })
  ),
});

export interface CdpEvent {
  readonly method: string;
  readonly params: unknown;
}

export interface Key {
  key: string;
  code: string;
  keyCode: number;
  modifiers?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ChromiumWindow {
  width: number;
  height: number;
}

export type CdpParams = Readonly<Record<string, unknown>>;

export interface CdpPage {
  send(method: string, params?: CdpParams): Effect.Effect<unknown, CdpCommandFailed>;
  request<A>(method: string, params: CdpParams, shape: Schema.Decoder<A>): Effect.Effect<A, CdpCommandFailed>;
  evaluate<A>(
    expression: string,
    shape: Schema.Decoder<A>
  ): Effect.Effect<A, CdpCommandFailed | CdpEvaluateFailed>;
  waitForExpression(
    expression: string,
    timeout?: Duration.Input
  ): Effect.Effect<boolean, CdpCommandFailed | CdpEvaluateFailed>;
  pressKey(key: Key): Effect.Effect<void, CdpCommandFailed>;
  clickPoint(point: Point, hover?: Duration.Input): Effect.Effect<void, CdpCommandFailed>;
  subscribe(...methods: string[]): Effect.Effect<Stream.Stream<CdpEvent>, never, Scope.Scope>;
}

export const PLAYWRIGHT_CACHE = 'Library/Caches/ms-playwright';

export const CHROMIUM_BUILD = /^chromium-\d+$/;

export const CHROMIUM_IN_BUILD =
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

export const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const DESKTOP_WINDOW: ChromiumWindow = { width: 1440, height: 1000 };

export const CDP_PORT_RANGE = { from: 9600, to: 9899 };

export const STDERR_TAIL_CHARS = 2000;

export const LAUNCH_TIMEOUT = Duration.seconds(30);

export const WAIT_TIMEOUT = Duration.seconds(15);

export const HOVER = Duration.millis(120);

export const LAUNCH_POLL = Schedule.spaced(Duration.millis(100));

export const EXPRESSION_POLL = Schedule.spaced(Duration.millis(50));
