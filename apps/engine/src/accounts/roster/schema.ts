import type {
  AccountOrigin,
  ChatNotice,
  DomainError,
  ProviderLogin,
  ShinsaCommand,
  ShinsaState,
} from '@shinsa/core';
import { Schema } from 'effect';
import type { Duration, Effect } from 'effect';
import type { ProviderUsageSource } from '../../agents/providers/index.ts';
import type { ServerConfig } from '../../config/index.ts';
import type { Engine } from '../../runtime/engine.ts';
import type { SecretReader } from '../credentials.ts';
import type { Cswap } from '../cswap.ts';
import type { AccountImports } from '../imports.ts';
import type { UsageLimits } from '../limits.ts';
import type { AccountLogins, LoginFinisher, LoginSpawner, LoginTimers } from '../login.ts';
import type { Env } from '../paths.ts';
import type { LoginRenewal } from '../renewal.ts';
import type { AccountRotation, SignInState } from '../rotation.ts';
import type { StoredLogin, UsageRead } from '../schema.ts';
import type { ClaudeCommand, ClaudeRunner } from '../status/schema.ts';
import type { AccountStore } from '../store.ts';
import type { UsageRequester } from '../usage.ts';

export interface AccountsOptions {
  engine: Engine;
  config: ServerConfig;
  env?: Env;
  run?: ClaudeRunner;
  readSecret?: SecretReader;
  requestHttp?: UsageRequester;
  spawnLogin?: LoginSpawner;
  cswap?: Cswap;
  resolveClaude?: () => Promise<string>;
  now?: () => number;
  refreshIntervalMs?: number;
  loginTimers?: Partial<LoginTimers>;
  forward?: (runId: string, notice: ChatNotice) => void;
  providerLogins?: () => Promise<ProviderLogin[]>;
  providerUsage?: ProviderUsageSource[];
}

export class AccountStepFailed extends Schema.TaggedError<
  AccountStepFailed,
  { readonly brand: unique symbol }
>()('AccountStepFailed', {
  message: Schema.String,
}) {}

export type AccountsFailure = AccountStepFailed | DomainError;

export interface ProviderIdentity {
  readonly email: string | null;
  readonly plan: string | null;
}

export const SHARED_LOGIN_DETAIL: Record<Exclude<AccountOrigin, 'login'>, string> = {
  cswap:
    'Shinsa holds a copy of claude-swap’s login for this account, so each one signs the other out. Sign in again to give Shinsa a login of its own.',
  claude:
    'Shinsa runs this account on your Claude Code login, which Claude Code and claude-swap change and refresh too. Sign in again to give Shinsa a login of its own.',
};

export type LoginOutcome = Awaited<ReturnType<LoginFinisher>>;

interface AccountsParts {
  readonly store: AccountStore;
  readonly limits: UsageLimits;
  readonly providerLimits: UsageLimits;
  readonly logins: AccountLogins;
  readonly rotation: AccountRotation;
  readonly renewal: LoginRenewal;
  readonly imports: AccountImports;
  readonly signIns: Map<string, SignInState>;
}

export interface AccountsDefinition {
  readonly parts: AccountsParts;
  readonly inspect: boolean;
  readonly userHome: string;
  readonly refreshInterval: Duration.Duration;
  readonly now: Effect.Effect<number>;
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (command: ShinsaCommand, id: string) => Effect.Effect<void, AccountsFailure>;
  readonly listen: (onChange: Effect.Effect<void>) => Effect.Effect<Effect.Effect<void>>;
  readonly resolveClaude: Effect.Effect<string, AccountsFailure>;
  readonly run: ClaudeCommand<AccountsFailure>;
  readonly readProviderLogins: Effect.Effect<ProviderLogin[], AccountsFailure>;
  readonly usageSources: ReadonlyMap<string, ProviderUsageSource>;
  readonly readStoredLogin: (configDir: string | null) => Effect.Effect<StoredLogin | null, AccountsFailure>;
  readonly requestUsage: (accessToken: string) => Effect.Effect<UsageRead, AccountsFailure>;
  readonly forward: (runId: string, notice: ChatNotice) => Effect.Effect<void>;
}
