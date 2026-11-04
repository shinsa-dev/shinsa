import type {
  AccountOrigin as CoreAccountOrigin,
  AccountSignIn,
  ChatNotice,
  DomainError,
  ProviderLogin,
  FastModeAvailability,
  UsageWindow,
  UsageWindowKind,
} from '@shinsa/core';
import { Context, Duration, Effect, Schema } from 'effect';
import type { ProviderUsageReading } from '../agents/providers/types.ts';
import type { Env } from './paths.ts';

const Text = Schema.Trim.pipe(Schema.decodeTo(Schema.NonEmptyString));

const LenientText = Schema.optionalKey(Text.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

const LenientString = Schema.optionalKey(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

const LenientNumber = Schema.optionalKey(Schema.Finite.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

const LenientList = Schema.optionalKey(
  Schema.Array(Schema.Unknown).pipe(Schema.catchDecoding(() => Effect.succeedNone))
);

const LenientRecord = Schema.optionalKey(
  Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.catchDecoding(() => Effect.succeedNone))
);

const AccountOrigin = Schema.Literals(['claude', 'login', 'cswap']);

export const StoredAccountFields = Schema.Struct({
  id: Text,
  origin: AccountOrigin,
  configDir: LenientText,
  email: LenientText,
  organization: LenientText,
  plan: LenientText,
  addedAt: LenientNumber,
  paused: Schema.optionalKey(Schema.Boolean.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  switchAt: Schema.optionalKey(
    Schema.Finite.pipe(
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
      Schema.catchDecoding(() => Effect.succeedNone)
    )
  ),
});

export const RegistryFields = Schema.Struct({ defaultAccountId: LenientText, accounts: LenientList });

export interface StoredAccount {
  id: string;
  configDir: string | null;
  email: string | null;
  organization: string | null;
  plan: string | null;
  origin: CoreAccountOrigin;
  addedAt: number;
  paused: boolean;
  switchAt: number | null;
}

export interface Registry {
  version: 1;
  defaultAccountId: string | null;
  accounts: StoredAccount[];
}

export type AccountDetails = Partial<Pick<StoredAccount, 'email' | 'organization' | 'plan'>>;

export type AccountIdentity = Pick<StoredAccount, 'email' | 'organization'>;

export interface AccountFolderSources {
  sharedDir: string;
  sharedGlobalConfig: string;
}

export class SharedEntryUnlinked extends Schema.TaggedError<
  SharedEntryUnlinked,
  { readonly brand: unique symbol }
>()('SharedEntryUnlinked', { entry: Schema.String, message: Schema.String }) {}

export const SharedGlobalConfig = Schema.Record(Schema.String, Schema.Unknown);

export const StoredLoginAnswer = Schema.fromJsonString(
  Schema.Struct({
    claudeAiOauth: Schema.Struct({
      accessToken: Schema.NonEmptyString,
      refreshToken: LenientString,
      expiresAt: LenientNumber,
      subscriptionType: LenientString,
    }),
  })
);

export interface StoredLogin {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  plan: string | null;
}

export const AuthStatusAnswer = Schema.fromJsonString(
  Schema.Struct({
    loggedIn: Schema.optionalKey(Schema.Unknown),
    email: LenientText,
    account: LenientText,
    oauthAccount: Schema.optionalKey(
      Schema.Struct({ emailAddress: LenientText }).pipe(Schema.catchDecoding(() => Effect.succeedNone))
    ),
    orgName: LenientText,
    subscriptionType: LenientText,
  })
);

export interface AuthStatus {
  signIn: AccountSignIn;
  email: string | null;
  organization: string | null;
  plan: string | null;
  detail: string | null;
}

export const CswapListAnswer = Schema.fromJsonString(Schema.Struct({ accounts: LenientList }));

export const CswapEntry = Schema.Struct({ email: Schema.String, kind: Schema.optionalKey(Schema.Unknown) });

export interface CswapAccount {
  email: string;
}

export const UsageBody = Schema.Struct({
  limits: LenientList,
  extra_usage: Schema.optionalKey(Schema.Unknown),
  five_hour: Schema.optionalKey(Schema.Unknown),
  seven_day: Schema.optionalKey(Schema.Unknown),
  seven_day_opus: Schema.optionalKey(Schema.Unknown),
  seven_day_sonnet: Schema.optionalKey(Schema.Unknown),
});

export const UsageLimitEntry = Schema.Struct({
  kind: Schema.String,
  percent: Schema.Finite,
  resets_at: Schema.optionalKey(Schema.Unknown),
  scope: Schema.optionalKey(Schema.Unknown),
});

export const UsageLimitScope = Schema.Struct({
  model: Schema.Struct({ display_name: Schema.String }),
});

export const UsageKeyedEntry = Schema.Struct({
  utilization: Schema.Finite,
  resets_at: Schema.optionalKey(Schema.Unknown),
});

export const ExtraUsage = Schema.Struct({
  is_enabled: Schema.optionalKey(Schema.Unknown),
  monthly_limit: LenientNumber,
  used_credits: LenientNumber,
});

export const UsageBodyText = Schema.fromJsonString(Schema.Unknown);

const UsageReadReason = Schema.Literals(['expired', 'limited', 'failed']);

export class UsageReadFailed extends Schema.TaggedError<UsageReadFailed, { readonly brand: unique symbol }>()(
  'UsageReadFailed',
  { reason: UsageReadReason, detail: Schema.String, retryAfterMs: Schema.NullOr(Schema.Number) }
) {}

export interface UsageAnswer {
  windows: UsageWindow[];
  fastMode: FastModeAvailability;
}

export type UsageRead =
  | { ok: true; windows: UsageWindow[]; fastMode?: FastModeAvailability }
  | { ok: false; reason: typeof UsageReadReason.Type; detail: string; retryAfterMs: number | null };

export interface KeyedWindow {
  id: string;
  kind: UsageWindowKind;
  label: string;
  model: string | null;
}

export const KEYED_WINDOWS: Record<string, KeyedWindow> = {
  five_hour: { id: 'five_hour', kind: 'session', label: '5-hour limit', model: null },
  seven_day: { id: 'seven_day', kind: 'weekly', label: 'Weekly · All models', model: null },
  seven_day_opus: { id: 'weekly:opus', kind: 'model', label: 'Weekly · Opus', model: 'Opus' },
  seven_day_sonnet: { id: 'weekly:sonnet', kind: 'model', label: 'Weekly · Sonnet', model: 'Sonnet' },
};

export const PROVIDER_WINDOWS: Record<string, KeyedWindow> = {
  five_hour: { id: 'five_hour', kind: 'session', label: '5-hour limit', model: null },
  seven_day: { id: 'seven_day', kind: 'weekly', label: 'Weekly limit', model: null },
};

export const LIMIT_KINDS: Record<string, string> = { session: 'five_hour', weekly_all: 'seven_day' };

export const EXPIRED_DETAIL =
  'The login needs refreshing. It refreshes the next time an agent runs on this account.';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export const USAGE_HEADERS = { 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'shinsa' };

export const USAGE_TIMEOUT = Duration.seconds(5);

export const UNAUTHORIZED = 401;

export const TOO_MANY_REQUESTS = 429;

export const CachedUsage = Schema.Struct({ windows: Schema.Array(Schema.Unknown) });

export const UsageCacheFields = Schema.Struct({ accounts: LenientRecord });

export const SpentMark = Schema.Struct({ until: Schema.NullOr(Schema.Finite), at: Schema.Finite });
export type SpentMark = typeof SpentMark.Type;

export const SpentMarksFields = Schema.Struct({ marks: LenientRecord });

export const USAGE_TTL = Duration.minutes(1);

const LIMITED_BACKOFF = Duration.minutes(5);

export const LIMITED_BACKOFF_MS = Duration.toMillis(LIMITED_BACKOFF);

export const UNKNOWN_RESET = Duration.minutes(15);

export const UNKNOWN_RESET_MS = Duration.toMillis(UNKNOWN_RESET);

const REFRESH_INTERVAL = Duration.minutes(5);

export const KEYCHAIN_TIMEOUT = Duration.seconds(5);

export const KEYCHAIN_COMMAND = '/usr/bin/security';

export const KEYCHAIN_NOT_FOUND = 44;

export const STATUS_TIMEOUT = Duration.seconds(15);

export const STATUS_TIMEOUT_MS = Duration.toMillis(STATUS_TIMEOUT);

export const CSWAP_BINARIES = ['cswap', 'claude-swap'];

export const CSWAP_TIMEOUT = Duration.seconds(30);

export const CSWAP_LIST_TTL = Duration.minutes(10);

const LOGIN_EXPIRY_MARGIN = Duration.minutes(1);

export const LOGIN_EXPIRY_MARGIN_MS = Duration.toMillis(LOGIN_EXPIRY_MARGIN);

const LOGIN_MENU_FALLBACK = Duration.seconds(5);

const LOGIN_URL_TIMEOUT = Duration.seconds(30);

const LOGIN_WATCHDOG = Duration.minutes(16);

export const LOGIN_TIMERS = {
  menuFallbackMs: Duration.toMillis(LOGIN_MENU_FALLBACK),
  urlTimeoutMs: Duration.toMillis(LOGIN_URL_TIMEOUT),
  watchdogMs: Duration.toMillis(LOGIN_WATCHDOG),
};

export const LOGIN_COLUMNS = 200;

export const LOGIN_ROWS = 50;

export const USAGE_RESUME_GRACE = Duration.seconds(5);

export const USAGE_RESUME_RETRY = Duration.minutes(1);

export const ACCOUNT_DIR_MODE = 0o700;

export const ACCOUNT_CONFIG_FILE = '.claude.json';

export const CREDENTIALS_FILE = '.credentials.json';

export interface SignInState {
  readonly signIn: AccountSignIn;
  readonly detail: string | null;
}

export const AccountsEnv = Context.Reference<Env>('shinsa/engine/accounts/AccountsEnv', {
  defaultValue: (): Env => Bun.env,
});

export const NewAccountId = Context.Reference<Effect.Effect<string>>('shinsa/engine/accounts/NewAccountId', {
  defaultValue: () => Effect.sync(() => crypto.randomUUID().slice(0, 8)),
});

export const AccountsRefreshInterval = Context.Reference<Duration.Duration>(
  'shinsa/engine/accounts/AccountsRefreshInterval',
  { defaultValue: () => REFRESH_INTERVAL }
);

export class AccountStepFailed extends Schema.TaggedError<
  AccountStepFailed,
  { readonly brand: unique symbol }
>()('AccountStepFailed', { message: Schema.String }) {}

export type AccountsFailure = AccountStepFailed | DomainError;

interface AccountUsageSource {
  readonly id: string;
  readonly read: Effect.Effect<ProviderUsageReading, { readonly message: string }>;
}

export interface AccountsInputShape {
  readonly usageSources: readonly AccountUsageSource[];
  readonly listProviderLogins: Effect.Effect<ProviderLogin[], AccountsFailure>;
  readonly forward: (runId: string, notice: ChatNotice) => Effect.Effect<void>;
}

export const AccountsInput = Context.Reference<AccountsInputShape>('shinsa/engine/accounts/AccountsInput', {
  defaultValue: (): AccountsInputShape => ({
    usageSources: [],
    listProviderLogins: Effect.succeed([]),
    forward: () => Effect.void,
  }),
});

export const ClaudeCommandPath = Context.Reference<Effect.Effect<string, AccountsFailure> | null>(
  'shinsa/engine/accounts/ClaudeCommandPath',
  { defaultValue: () => null }
);

export const UsageTtl = Context.Reference<Duration.Duration>('shinsa/engine/accounts/UsageTtl', {
  defaultValue: () => USAGE_TTL,
});

export interface ProviderIdentity {
  readonly email: string | null;
  readonly plan: string | null;
}
