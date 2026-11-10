import { Context, Duration, Schema } from 'effect';
import { UNAUTHORIZED, type StoredAccount } from '../schema.ts';

const KEEPALIVE_MODEL = 'haiku';

const KEEPALIVE_PROMPT = 'Reply with the single word ok.';

export const KEEPALIVE_TIMEOUT = Duration.seconds(60);

const KEEPALIVE_MARGIN = Duration.minutes(10);

const KEEPALIVE_BACKOFF = Duration.minutes(30);

export interface KeepaliveTimingsShape {
  readonly marginMs: number;
  readonly backoffMs: number;
}

export const KeepaliveTimings = Context.Reference<KeepaliveTimingsShape>(
  'shinsa/engine/accounts/keepalive/KeepaliveTimings',
  {
    defaultValue: (): KeepaliveTimingsShape => ({
      marginMs: Duration.toMillis(KEEPALIVE_MARGIN),
      backoffMs: Duration.toMillis(KEEPALIVE_BACKOFF),
    }),
  }
);

export const KEEPALIVE_SIGNED_OUT_DETAIL =
  'Claude could not refresh this account’s login. Sign in again to keep its usage current.';

const KeepaliveAnswer = Schema.Struct({
  is_error: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.String),
  api_error_status: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const KeepaliveAnswerText = Schema.fromJsonString(KeepaliveAnswer);

export type KeepaliveAnswer = typeof KeepaliveAnswer.Type;

export const KEEPALIVE_AUTH_STATUSES: ReadonlySet<number> = new Set([UNAUTHORIZED]);

export interface KeepaliveRequest {
  readonly account: StoredAccount;
  readonly claude: string;
  readonly readExpired: boolean;
  readonly force: boolean;
}

export type KeepaliveOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'refreshed' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'signed_out'; readonly detail: string };

export const KEEPALIVE_ARGS: readonly string[] = [
  '-p',
  KEEPALIVE_PROMPT,
  '--model',
  KEEPALIVE_MODEL,
  '--output-format',
  'json',
  '--tools',
  '',
  '--strict-mcp-config',
  '--setting-sources',
  '',
  '--disable-slash-commands',
  '--no-session-persistence',
];

export const KEEPALIVE_IDLE: KeepaliveOutcome = { kind: 'idle' };
