import { join } from 'node:path';
import { type AccountsSnapshot, type ChatNotice, DomainError } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import type { AccountLeaseRequest, RunRejection } from '../agents/index.ts';
import { resolveClaudeExecutable } from '../agents/providers/claude/executable.ts';
import { type AccountSource, createSummaryAccountSource } from '../onboarding/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { runCommand } from '../shell/index.ts';
import { createKeychainReader, readStoredLogin } from './credentials.ts';
import { Cswap } from './cswap.ts';
import { AccountImports } from './imports.ts';
import { UsageLimits } from './limits.ts';
import { AccountLogins, spawnLoginTerminal } from './login.ts';
import { resolveSharedConfigDir, resolveSharedGlobalConfig } from './paths.ts';
import { LoginRenewal } from './renewal.ts';
import { resolveAccountFailure } from './roster/failure.ts';
import type { AccountsOptions } from './roster/schema.ts';
import { makeAccounts } from './roster/service.ts';
import { AccountRotation, type SignInState } from './rotation.ts';
import { REFRESH_INTERVAL_MS } from './schema.ts';
import { AccountStore } from './store.ts';
import { PROVIDER_WINDOWS, requestUsage } from './usage.ts';

export { UsageResumeClock } from './resume.ts';
export type { AccountsOptions } from './roster/schema.ts';

type AccountsHandle = Effect.Success<ReturnType<typeof makeAccounts>>;

const RESOLVE_CLAUDE = Effect.tryPromise({
  try: () => resolveClaudeExecutable(),
  catch: resolveAccountFailure,
}).pipe(
  Effect.flatMap((executable) =>
    executable.ok
      ? Effect.succeed(executable.path)
      : Effect.fail(new DomainError({ code: 'claude_missing', message: executable.message }))
  )
);

export class Accounts {
  readonly store: AccountStore;
  readonly limits: UsageLimits;
  readonly providerLimits: UsageLimits;
  readonly logins: AccountLogins;
  readonly #rotation: AccountRotation;
  readonly #handle: AccountsHandle;

  constructor(options: AccountsOptions) {
    const { engine, config } = options;
    const env = options.env ?? Bun.env;
    const run = options.run ?? runCommand;
    const readSecret = options.readSecret ?? createKeychainReader();
    const now = options.now ?? Date.now;
    const userHome = config.userHome;
    const signIns = new Map<string, SignInState>();
    const changed = () => edgeRuntime.runSync(this.#handle.changed);
    this.store = new AccountStore({
      home: config.home,
      sharedDir: resolveSharedConfigDir(env, userHome),
      sharedGlobalConfig: resolveSharedGlobalConfig(env, userHome),
      now,
    });
    this.limits = new UsageLimits({
      path: join(config.dataDir, 'usage-limits.json'),
      read: (accountId) => edgeRuntime.runPromise(this.#handle.readUsage(accountId)),
      now,
    });
    this.providerLimits = new UsageLimits({
      path: join(config.dataDir, 'provider-usage.json'),
      read: (provider) => edgeRuntime.runPromise(this.#handle.readProviderUsage(provider)),
      now,
      windows: PROVIDER_WINDOWS,
      emptyDetail: 'No usage limits reported for this sign-in.',
    });
    this.logins = new AccountLogins({
      spawn: options.spawnLogin ?? spawnLoginTerminal,
      finish: (accountId, loginId) => edgeRuntime.runPromise(this.#handle.finishLogin(accountId, loginId)),
      onChange: changed,
      onEnded: (login) =>
        edgeRuntime.runSync(this.#handle.loginEnded(login.accountId, login.phase === 'done')),
      now,
      timers: options.loginTimers,
    });
    const renewal = new LoginRenewal({ env, userHome, readSecret, now });
    this.#rotation = new AccountRotation({
      store: this.store,
      limits: this.limits,
      renewal,
      signIns,
      state: () => engine.state,
      now,
      onChange: changed,
      marksPath: join(config.dataDir, 'account-marks.json'),
    });
    const imports = new AccountImports({
      store: this.store,
      cswap: options.cswap ?? new Cswap({ run }),
      signIn: (email) => edgeRuntime.runPromise(this.#handle.beginLogin(null, email)),
      onChange: changed,
    });
    const { store, limits, providerLimits, logins } = this;
    const resolveClaude = options.resolveClaude;
    const readProviderLogins = options.providerLogins;
    const forward = options.forward;
    this.#handle = edgeRuntime.runSync(
      makeAccounts({
        parts: { store, limits, providerLimits, logins, rotation: this.#rotation, renewal, imports, signIns },
        inspect: config.inspect,
        userHome,
        refreshInterval: Duration.millis(options.refreshIntervalMs ?? REFRESH_INTERVAL_MS),
        now: Effect.sync(now),
        state: Effect.sync(() => engine.state),
        dispatch: (command, id) =>
          Effect.asVoid(
            Effect.tryPromise({ try: () => engine.dispatch(command, { id }), catch: resolveAccountFailure })
          ),
        listen: (onChange) =>
          Effect.sync(() => {
            const notify = () => edgeRuntime.runSync(onChange);
            const releases = [
              store.subscribe(notify),
              limits.subscribe(notify),
              providerLimits.subscribe(notify),
              engine.subscribe(notify),
            ];
            return Effect.sync(() => {
              for (const release of releases) release();
            });
          }),
        resolveClaude: resolveClaude
          ? Effect.tryPromise({ try: () => resolveClaude(), catch: resolveAccountFailure })
          : RESOLVE_CLAUDE,
        run: (command, cwd, commandOptions) =>
          Effect.tryPromise({ try: () => run(command, cwd, commandOptions), catch: resolveAccountFailure }),
        readProviderLogins: readProviderLogins
          ? Effect.tryPromise({ try: () => readProviderLogins(), catch: resolveAccountFailure })
          : Effect.succeed([]),
        usageSources: new Map((options.providerUsage ?? []).map((source) => [source.id, source])),
        readStoredLogin: (configDir) =>
          Effect.tryPromise({
            try: () => readStoredLogin({ configDir, env, userHome, readSecret }),
            catch: resolveAccountFailure,
          }),
        requestUsage: (accessToken) =>
          Effect.tryPromise({
            try: () => requestUsage(accessToken, options.requestHttp),
            catch: resolveAccountFailure,
          }),
        forward: (runId, notice) => Effect.sync(() => forward?.(runId, notice)),
      })
    );
  }

  start() {
    return edgeRuntime.runPromise(this.#handle.start);
  }

  stop() {
    edgeRuntime.runSync(this.#handle.stop);
  }

  syncProviderLogins() {
    return edgeRuntime.runPromise(this.#handle.syncProviderLogins);
  }

  syncSignIns() {
    return edgeRuntime.runPromise(this.#handle.syncSignIns);
  }

  subscribe(listener: (snapshot: AccountsSnapshot) => void) {
    return edgeRuntime.runSync(this.#handle.subscribe(listener));
  }

  snapshot(): AccountsSnapshot {
    return edgeRuntime.runSync(this.#handle.snapshot);
  }

  lease(request: AccountLeaseRequest) {
    return edgeRuntime.runPromise(this.#handle.lease(request));
  }

  readWeeklyReading(accountId: string, force: boolean) {
    return edgeRuntime.runPromise(this.#handle.readWeeklyReading(accountId, force));
  }

  readProviderWeeklyReading(provider: string, force: boolean) {
    return edgeRuntime.runPromise(this.#handle.readProviderWeeklyReading(provider, force));
  }

  readFastMode(provider: string, accountId: string | null) {
    return edgeRuntime.runPromise(this.#handle.readFastMode(provider, accountId));
  }

  readQuickFastMode = (provider: string) => this.readFastMode(provider, null);

  onRejection = (rejection: RunRejection) => {
    if (edgeRuntime.runSync(this.#handle.isProviderRejection(rejection)))
      return edgeRuntime.runPromise(this.#handle.recordProviderRejection(rejection));
    return this.#rotation.recordRejection(rejection);
  };

  onNotice = (runId: string, notice: ChatNotice) => {
    edgeRuntime.runSync(this.#handle.onNotice(runId, notice));
  };

  refresh() {
    return edgeRuntime.runPromise(this.#handle.refresh);
  }

  refreshUsage() {
    return edgeRuntime.runPromise(this.#handle.refreshUsage);
  }

  startLogin(accountId: string | null) {
    return edgeRuntime.runPromise(this.#handle.startLogin(accountId));
  }

  submitLoginCode(loginId: unknown, code: unknown) {
    return edgeRuntime.runSync(this.#handle.submitLoginCode(loginId, code));
  }

  cancelLogin(loginId: unknown) {
    return edgeRuntime.runSync(this.#handle.cancelLogin(loginId));
  }

  importAccount(origin: unknown, email: unknown) {
    return edgeRuntime.runPromise(this.#handle.importAccount(origin, email));
  }

  update(accountId: unknown, patchBody: unknown) {
    return edgeRuntime.runSync(this.#handle.update(accountId, patchBody));
  }

  remove(accountId: unknown) {
    return edgeRuntime.runPromise(this.#handle.remove(accountId));
  }
}

export function createOnboardingAccounts(accounts: Accounts): AccountSource {
  return createSummaryAccountSource(() => accounts.snapshot().accounts);
}
