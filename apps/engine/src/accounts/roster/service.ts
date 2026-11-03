import {
  type AccountDuplicate,
  type AccountSummary,
  type AccountsSnapshot,
  CLAUDE_PROVIDER,
  type ChatNotice,
  DomainError,
  type FastModeAvailability,
  listActiveRuns,
  listOpenGates,
  type ProviderLogin,
  resolveAgentModel,
  resolveCandidateSpentUntil,
  resolveSpentUntil,
  resolveWeeklyReading,
} from '@shinsa/core';
import { Effect, Exit, Fiber, Ref } from 'effect';
import type { AccountLeaseRequest, RejectionVerdict, RunRejection } from '../../agents/index.ts';
import { createReadOnlyError } from '../../instance/inspect.ts';
import { describeError } from '../../log/redact.ts';
import { parseAccountPatch } from '../patch.ts';
import { type Env, resolveAccountEnv } from '../paths.ts';
import type { RenewedLogin } from '../renewal.ts';
import { STATUS_TIMEOUT_MS, type UsageRead } from '../schema.ts';
import { readAuthStatus } from '../status/service.ts';
import { isSharedLogin, type StoredAccount } from '../store.ts';
import { EXPIRED_READ } from '../usage.ts';
import { resolveAccountFailure } from './failure.ts';
import {
  AccountStepFailed,
  type AccountsDefinition,
  type AccountsFailure,
  type LoginOutcome,
  type ProviderIdentity,
  SHARED_LOGIN_DETAIL,
} from './schema.ts';

export const makeAccounts = Effect.fn('Accounts.make')(function* (definition: AccountsDefinition) {
  const { store, limits, providerLimits, logins, rotation, renewal, imports, signIns } = definition.parts;
  const { usageSources } = definition;
  const providerLogins = yield* Ref.make<ProviderLogin[]>([]);
  const providerIdentities = yield* Ref.make<ReadonlyMap<string, ProviderIdentity>>(new Map());
  const newLogins = yield* Ref.make<ReadonlySet<string>>(new Set());
  const last = yield* Ref.make('');
  const duplicates = yield* Ref.make<ReadonlySet<string>>(new Set());
  const timer = yield* Ref.make<Fiber.Fiber<never> | null>(null);
  const releases = yield* Ref.make<ReadonlyArray<Effect.Effect<void>>>([]);
  const stopped = yield* Ref.make(false);
  const listeners = new Set<(snapshot: AccountsSnapshot) => void>();

  const attempt = <A>(evaluate: () => Promise<A>) =>
    Effect.tryPromise({ try: evaluate, catch: resolveAccountFailure });

  const attemptSync = <A>(evaluate: () => A) => Effect.try({ try: evaluate, catch: resolveAccountFailure });

  const forgetNew = (accountId: string) =>
    Ref.update(newLogins, (ids) => new Set([...ids].filter((id) => id !== accountId)));

  const assertChangeable = Effect.gen(function* () {
    if (definition.inspect) return yield* createReadOnlyError();
  });

  const listIds = Effect.sync(() => store.listDistinct().map((account) => account.id));

  const listProviderSummaries = Effect.gen(function* () {
    const identities = yield* Ref.get(providerIdentities);
    return (yield* Ref.get(providerLogins)).map((login): ProviderLogin => {
      if (!usageSources.has(login.provider)) return login;
      const identity = identities.get(login.provider);
      return {
        ...login,
        email: identity?.email ?? null,
        plan: identity?.plan ?? null,
        usage: providerLimits.snapshot(login.provider),
      };
    });
  });

  const snapshot = Effect.gen(function* () {
    const state = yield* definition.state;
    const now = yield* definition.now;
    const runs = new Map<string, number>();
    for (const run of listActiveRuns(state)) {
      const id = run.attempts?.at(-1)?.account?.id;
      if (id) runs.set(id, (runs.get(id) ?? 0) + 1);
    }
    const model = resolveAgentModel(state.settings, 'agent', CLAUDE_PROVIDER);
    const kept = store.resolveDuplicates();
    const accounts = store.listDistinct().map((account): AccountSummary => {
      const signIn = signIns.get(account.id);
      const usage = limits.snapshot(account.id);
      const marked = rotation.resolveSpentUntil(account.id);
      return {
        id: account.id,
        email: account.email,
        organization: account.organization,
        plan: account.plan,
        origin: account.origin,
        isDefault: store.isDefault(account.id, kept),
        paused: account.paused,
        switchAt: account.switchAt,
        signIn: signIn?.signIn ?? 'unknown',
        signInDetail: signIn?.detail ?? null,
        usage,
        spentUntil: resolveCandidateSpentUntil({ spentUntil: marked, usage }, model, now),
        runs: runs.get(account.id) ?? 0,
      };
    });
    const found = store.list().flatMap((account): AccountDuplicate[] => {
      const keptId = kept.get(account.id);
      if (!keptId || !account.email) return [];
      return [{ id: account.id, email: account.email, keptId }];
    });
    const answer: AccountsSnapshot = {
      accounts,
      login: logins.current(),
      imports: imports.list(),
      duplicates: found,
      providers: yield* listProviderSummaries,
    };
    return answer;
  });

  const recordDuplicates = Effect.fn('Accounts.recordDuplicates')(function* (found: AccountDuplicate[]) {
    const known = yield* Ref.get(duplicates);
    for (const duplicate of found) {
      if (known.has(duplicate.id)) continue;
      yield* Effect.logInfo(
        '[Accounts] Two accounts hold the same login; Shinsa uses one and leaves the other alone'
      ).pipe(
        Effect.annotateLogs({ accountId: duplicate.id, keptId: duplicate.keptId, email: duplicate.email })
      );
    }
    yield* Ref.set(duplicates, new Set(found.map((duplicate) => duplicate.id)));
  });

  const changed = Effect.gen(function* () {
    const next = yield* snapshot;
    const serialized = JSON.stringify(next);
    if (serialized === (yield* Ref.getAndSet(last, serialized))) return;
    yield* recordDuplicates(next.duplicates ?? []);
    yield* Effect.sync(() => {
      for (const listener of listeners) listener(next);
    });
  });

  const subscribe = (listener: (snapshot: AccountsSnapshot) => void) =>
    Effect.sync(() => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });

  const readStatus = Effect.fn('Accounts.readStatus')(function* (env: Env) {
    const claude = yield* definition.resolveClaude;
    return yield* readAuthStatus(definition.run, claude, env, definition.userHome);
  });

  const refreshLimits = Effect.fn('Accounts.refreshLimits')(function* (force: boolean) {
    const ids = yield* listIds;
    yield* attempt(() => limits.refresh(ids, force));
  });

  const refreshProviderUsage = (force: boolean) =>
    attempt(() => providerLimits.refresh([...usageSources.keys()], force));

  const readProviderUsage = Effect.fn('Accounts.readProviderUsage')(function* (provider: string) {
    const source = usageSources.get(provider);
    if (!source) return yield* new AccountStepFailed({ message: `Shinsa reads no usage for ${provider}.` });
    const reading = yield* attempt(() => source.read());
    yield* Ref.update(providerIdentities, (identities) => {
      const known = identities.get(provider);
      return new Map(identities).set(provider, {
        email: reading.email ?? known?.email ?? null,
        plan: reading.plan ?? known?.plan ?? null,
      });
    });
    return reading.read;
  });

  const answerProviderSignIns = Effect.gen(function* () {
    for (const login of yield* Ref.get(providerLogins)) {
      if (login.status !== 'signed_in') continue;
      const gates = listOpenGates(yield* definition.state).filter(
        (gate) => gate.type === 'sign_in' && gate.provider === login.provider && !gate.account
      );
      if (gates.length === 0) continue;
      const ids = gates.map((gate) => gate.id).join(',');
      yield* definition
        .dispatch(
          { type: 'provider.record_sign_in', provider: login.provider },
          `provider-login:${login.provider}:${ids}`
        )
        .pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Accounts] Could not carry on after a provider sign-in').pipe(
              Effect.annotateLogs({ provider: login.provider, error: describeError(failure) })
            )
          )
        );
    }
  });

  const syncProviderLogins = Effect.gen(function* () {
    yield* definition.readProviderLogins.pipe(
      Effect.flatMap((found) => Ref.set(providerLogins, found)),
      Effect.catch((failure) =>
        Effect.logWarning('[Accounts] Could not check the other providers’ sign-ins').pipe(
          Effect.annotateLogs({ error: describeError(failure) })
        )
      )
    );
    yield* answerProviderSignIns;
    yield* changed;
  });

  const syncSignIn = Effect.fn('Accounts.syncSignIn')(function* (account: StoredAccount) {
    if (account.origin !== 'login') {
      signIns.set(account.id, { signIn: 'signed_out', detail: SHARED_LOGIN_DETAIL[account.origin] });
      return yield* changed;
    }
    const status = yield* readStatus(resolveAccountEnv(account.configDir)).pipe(
      Effect.catch((failure) =>
        Effect.succeed({
          signIn: 'unknown' as const,
          email: null,
          organization: null,
          plan: null,
          detail: describeError(failure),
        })
      )
    );
    yield* Effect.sync(() => {
      signIns.set(account.id, { signIn: status.signIn, detail: status.detail });
      if (status.signIn !== 'signed_in') return;
      store.update(account.id, {
        email: status.email ?? account.email,
        organization: status.organization ?? account.organization,
        plan: account.plan ?? status.plan,
      });
    });
    yield* changed;
  });

  const syncSignIns = Effect.gen(function* () {
    yield* Effect.forEach(store.list(), syncSignIn, { concurrency: 'unbounded', discard: true });
  });

  const readUsage = Effect.fn('Accounts.readUsage')(function* (accountId: string) {
    const account = store.select(accountId);
    if (!account) {
      const removed: UsageRead = {
        ok: false,
        reason: 'failed',
        detail: 'The account was removed.',
        retryAfterMs: null,
      };
      return removed;
    }
    const login = yield* definition.readStoredLogin(account.configDir);
    if (!login) {
      const missing: UsageRead = {
        ok: false,
        reason: 'expired',
        detail: 'Shinsa could not find this account’s login. Sign in again.',
        retryAfterMs: null,
      };
      return missing;
    }
    if (login.plan && !account.plan) yield* Effect.sync(() => store.update(account.id, { plan: login.plan }));
    if (login.expiresAt !== null && login.expiresAt <= (yield* definition.now)) return EXPIRED_READ;
    return yield* definition.requestUsage(login.accessToken);
  });

  const resumeOne = Effect.fn('Accounts.resumeOne')(function* ({ account, fingerprint }: RenewedLogin) {
    signIns.set(account.id, { signIn: 'signed_in', detail: null });
    yield* Effect.logInfo('[Accounts] A login that needed signing in works again; carrying on').pipe(
      Effect.annotateLogs({ accountId: account.id, email: account.email })
    );
    yield* definition
      .dispatch(
        { type: 'account.signed_in', account: { id: account.id, email: account.email } },
        `login-renewed:${account.id}:${fingerprint}`
      )
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Accounts] Could not carry on after a login works again').pipe(
            Effect.annotateLogs({ accountId: account.id, error: describeError(failure) })
          )
        )
      );
  });

  const resumeRenewed = Effect.gen(function* () {
    const renewed = yield* attempt(() =>
      renewal.listRenewed(store.list().filter((account) => !isSharedLogin(account)))
    ).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('[Accounts] Could not check the logins that needed signing in').pipe(
          Effect.annotateLogs({ error: describeError(failure) }),
          Effect.as(null)
        )
      )
    );
    if (renewed === null) return;
    yield* Effect.forEach(renewed, resumeOne, { concurrency: 'unbounded', discard: true });
    if (renewed.length > 0) yield* changed;
  });

  const ignoreRefresh = Effect.ignore({ log: 'Warn', message: '[Accounts] Could not refresh the accounts' });

  const tick = Effect.all(
    [
      refreshLimits(false).pipe(ignoreRefresh),
      refreshProviderUsage(false).pipe(ignoreRefresh),
      syncProviderLogins,
      resumeRenewed,
    ],
    { concurrency: 'unbounded', discard: true }
  );

  const settleAll = Effect.fn('Accounts.settleAll')(function* (
    steps: ReadonlyArray<Effect.Effect<void, AccountsFailure>>
  ) {
    const exits = yield* Effect.forEach(steps, Effect.exit, { concurrency: 'unbounded' });
    const failed = exits.find(Exit.isFailure);
    if (failed) return yield* Effect.failCause(failed.cause);
  });

  const start = Effect.gen(function* () {
    const release = yield* definition.listen(changed);
    yield* Ref.update(releases, (all) => [...all, release]);
    if (definition.inspect) return yield* changed;
    yield* settleAll([syncSignIns, attempt(() => imports.sync()), syncProviderLogins]);
    yield* settleAll([refreshLimits(false), refreshProviderUsage(false)]);
    if (yield* Ref.get(stopped)) return;
    const fiber = yield* Effect.forkDetach(Effect.forever(Effect.delay(tick, definition.refreshInterval)));
    yield* Ref.set(timer, fiber);
    yield* changed;
  });

  const stop = Effect.gen(function* () {
    yield* Ref.set(stopped, true);
    const fiber = yield* Ref.getAndSet(timer, null);
    if (fiber) yield* Effect.forkDetach(Fiber.interrupt(fiber));
    for (const release of yield* Ref.getAndSet(releases, [])) yield* release;
    yield* Effect.sync(() => logins.stop());
  });

  const lease = (request: AccountLeaseRequest) => Effect.sync(() => rotation.lease(request));

  const readWeeklyReading = Effect.fn('Accounts.readWeeklyReading')(function* (
    accountId: string,
    force: boolean
  ) {
    const pushed = limits.snapshot(accountId).source === 'push';
    yield* attempt(() => limits.refresh([accountId], force || pushed));
    return resolveWeeklyReading(limits.snapshot(accountId));
  });

  const readProviderWeeklyReading = Effect.fn('Accounts.readProviderWeeklyReading')(function* (
    provider: string,
    force: boolean
  ) {
    if (!usageSources.has(provider)) return null;
    const pushed = providerLimits.snapshot(provider).source === 'push';
    yield* attempt(() => providerLimits.refresh([provider], force || pushed));
    return resolveWeeklyReading(providerLimits.snapshot(provider));
  });

  const readFastMode = Effect.fn('Accounts.readFastMode')(function* (
    provider: string,
    accountId: string | null
  ) {
    const unknown: FastModeAvailability = 'unknown';
    if (accountId === null && usageSources.has(provider)) {
      yield* attempt(() => providerLimits.refresh([provider]));
      return providerLimits.snapshot(provider).fastMode ?? unknown;
    }
    if (provider !== CLAUDE_PROVIDER || accountId === null) return unknown;
    yield* attempt(() => limits.refresh([accountId]));
    return limits.snapshot(accountId).fastMode ?? unknown;
  });

  const isProviderRejection = (rejection: RunRejection) =>
    Effect.sync(() => rejection.accountId === null && usageSources.has(rejection.provider));

  const markProviderSignedOut = Effect.fn('Accounts.markProviderSignedOut')(function* (
    provider: string,
    detail: string
  ) {
    yield* Ref.update(providerLogins, (all) =>
      all.map((login): ProviderLogin =>
        login.provider === provider ? { ...login, status: 'signed_out', detail } : login
      )
    );
    yield* changed;
  });

  const recordProviderRejection = Effect.fn('Accounts.recordProviderRejection')(function* (
    rejection: RunRejection
  ) {
    const { failure, provider } = rejection;
    const refused: RejectionVerdict = { retry: false };
    if (failure.class === 'auth') {
      yield* markProviderSignedOut(provider, failure.message);
      const email = (yield* Ref.get(providerIdentities)).get(provider)?.email ?? null;
      const verdict: RejectionVerdict = { retry: false, failure: { ...failure, login: { provider, email } } };
      return verdict;
    }
    if (failure.class !== 'usage_limit') return refused;
    if (failure.resetAt !== null) {
      yield* Effect.forkDetach(refreshProviderUsage(true).pipe(ignoreRefresh));
      return refused;
    }
    const model = (yield* definition.state).runs[rejection.runId]?.model ?? null;
    const pushed = resolveSpentUntil(providerLimits.snapshot(provider), model, yield* definition.now);
    if (pushed !== null) {
      const verdict: RejectionVerdict = { retry: false, failure: { ...failure, resetAt: pushed } };
      return verdict;
    }
    yield* refreshProviderUsage(true);
    const resetAt = resolveSpentUntil(providerLimits.snapshot(provider), model, yield* definition.now);
    const verdict: RejectionVerdict = { retry: false, failure: { ...failure, resetAt } };
    return verdict;
  });

  const onNotice = Effect.fn('Accounts.onNotice')(function* (runId: string, notice: ChatNotice) {
    yield* definition.forward(runId, notice);
    const latest = (yield* definition.state).runs[runId]?.attempts?.at(-1);
    const accountId = latest?.account?.id;
    if (!accountId) {
      if (notice.kind === 'rate_limit' && latest && usageSources.has(latest.provider))
        providerLimits.recordPush(latest.provider, notice);
      return;
    }
    if (notice.kind === 'rate_limit') return limits.recordPush(accountId, notice);
    if (notice.kind !== 'account' || !notice.email) return;
    const account = store.select(accountId);
    if (!account) return;
    signIns.set(accountId, { signIn: 'signed_in', detail: null });
    store.update(accountId, {
      email: notice.email,
      organization: notice.organization ?? account.organization,
      plan: notice.plan ?? account.plan,
    });
    yield* changed;
  });

  const refresh = Effect.gen(function* () {
    yield* assertChangeable;
    yield* settleAll([syncSignIns, attempt(() => imports.sync()), syncProviderLogins]);
    yield* resumeRenewed;
    yield* settleAll([refreshLimits(true), refreshProviderUsage(true)]);
    return yield* snapshot;
  });

  const refreshUsage = Effect.gen(function* () {
    yield* assertChangeable;
    yield* settleAll([refreshLimits(false), refreshProviderUsage(false)]);
    return yield* snapshot;
  });

  const beginLogin = Effect.fn('Accounts.beginLogin')(function* (
    existing: StoredAccount | null,
    email: string | null
  ) {
    const claude = yield* definition.resolveClaude;
    const account = yield* attemptSync(() =>
      existing ? store.createFolder(existing.id) : store.create({ email })
    );
    if (!account?.configDir) return;
    if (!existing) yield* Ref.update(newLogins, (ids) => new Set(ids).add(account.id));
    const configDir = account.configDir;
    yield* Effect.sync(() =>
      logins.start({
        accountId: account.id,
        claude,
        cwd: configDir,
        env: resolveAccountEnv(configDir),
        email: account.email,
      })
    );
  });

  const startLogin = Effect.fn('Accounts.startLogin')(function* (accountId: string | null) {
    yield* assertChangeable;
    const existing = accountId ? yield* attemptSync(() => store.find(accountId)) : null;
    yield* beginLogin(existing, null);
    return yield* snapshot;
  });

  const signOutFolder = Effect.fn('Accounts.signOutFolder')(function* (account: StoredAccount) {
    if (!account.configDir) return;
    const claude = yield* definition.resolveClaude;
    const result = yield* definition.run([claude, 'auth', 'logout'], definition.userHome, {
      env: resolveAccountEnv(account.configDir),
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    if (result.ok) return;
    yield* Effect.logWarning('[Accounts] Could not sign an account’s folder out').pipe(
      Effect.annotateLogs({ accountId: account.id, code: result.code })
    );
  });

  const finishLogin = Effect.fn('Accounts.finishLogin')(function* (accountId: string, loginId: string) {
    const account = store.select(accountId);
    const outcome = (message: string): LoginOutcome => ({ ok: false, message });
    if (!account) return outcome('The account was removed while you signed in.');
    const status = yield* readStatus(resolveAccountEnv(account.configDir));
    if (status.signIn !== 'signed_in')
      return outcome('Sign-in finished, but Claude still reports this account as signed out.');
    const isNew = (yield* Ref.get(newLogins)).has(accountId);
    if (account.email && status.email?.toLowerCase() !== account.email.toLowerCase()) {
      const message = `You signed in as ${status.email ?? 'another account'}, not ${account.email}. Sign in as ${account.email} instead.`;
      if (!isNew) {
        yield* signOutFolder(account);
        signIns.set(accountId, { signIn: 'signed_out', detail: message });
        yield* changed;
      }
      return outcome(message);
    }
    if (store.selectByIdentity(status, accountId) && isNew)
      return outcome(`${status.email} is already added.`);
    yield* Effect.sync(() => {
      store.update(accountId, {
        email: status.email ?? account.email,
        organization: status.organization ?? account.organization,
        plan: account.plan ?? status.plan,
        origin: 'login',
      });
      signIns.set(accountId, { signIn: 'signed_in', detail: null });
      rotation.clear(accountId);
      renewal.clear(accountId);
    });
    yield* forgetNew(accountId);
    yield* definition.dispatch(
      { type: 'account.signed_in', account: { id: accountId, email: status.email ?? account.email } },
      `login:${loginId}:account.signed_in`
    );
    yield* attempt(() => limits.refresh([accountId], true));
    yield* attempt(() => imports.sync());
    const signedIn: LoginOutcome = { ok: true, email: status.email };
    return signedIn;
  });

  const forget = Effect.fn('Accounts.forget')(function* (accountId: string) {
    yield* signOutFolder(yield* attemptSync(() => store.find(accountId)));
    yield* Effect.sync(() => {
      store.remove(accountId);
      limits.remove(accountId);
      signIns.delete(accountId);
      rotation.clear(accountId);
      renewal.clear(accountId);
    });
    yield* forgetNew(accountId);
  });

  const loginEnded = Effect.fn('Accounts.loginEnded')(function* (accountId: string, done: boolean) {
    if (done || !(yield* Ref.get(newLogins)).has(accountId)) return;
    yield* forgetNew(accountId);
    yield* Effect.forkDetach(
      forget(accountId).pipe(
        Effect.andThen(attempt(() => imports.sync())),
        Effect.catch((failure) =>
          Effect.logWarning('[Accounts] Could not clear an account that never signed in').pipe(
            Effect.annotateLogs({ accountId, error: describeError(failure) })
          )
        )
      )
    );
  });

  const submitLoginCode = Effect.fn('Accounts.submitLoginCode')(function* (loginId: unknown, code: unknown) {
    if (typeof loginId !== 'string' || typeof code !== 'string' || !code.trim())
      return yield* new DomainError({
        code: 'code_invalid',
        message: 'Paste the code the sign-in page showed.',
      });
    if (!logins.submitCode(loginId, code))
      return yield* new DomainError({ code: 'login_stale', message: 'That sign-in ended. Start it again.' });
    return yield* snapshot;
  });

  const cancelLogin = Effect.fn('Accounts.cancelLogin')(function* (loginId: unknown) {
    if (typeof loginId !== 'string')
      return yield* new DomainError({ code: 'login_invalid', message: 'Name the sign-in to cancel.' });
    const phase = logins.current()?.phase;
    if (phase === 'done' || phase === 'failed') logins.clear(loginId);
    else logins.cancel(loginId);
    return yield* snapshot;
  });

  const importAccount = Effect.fn('Accounts.importAccount')(function* (origin: unknown, email: unknown) {
    yield* assertChangeable;
    yield* attempt(() => imports.importAccount(origin, email));
    return yield* snapshot;
  });

  const update = Effect.fn('Accounts.update')(function* (accountId: unknown, patchBody: unknown) {
    yield* assertChangeable;
    if (typeof accountId !== 'string')
      return yield* new DomainError({ code: 'account_invalid', message: 'Name the account to change.' });
    yield* attemptSync(() => {
      const account = store.find(accountId);
      const patch = parseAccountPatch(patchBody);
      if (patch.isDefault) store.updateDefault(account.id);
      if (patch.paused !== undefined) store.update(account.id, { paused: patch.paused });
      if (patch.switchAt !== undefined) store.update(account.id, { switchAt: patch.switchAt });
      if (patch.position !== undefined) store.move(account.id, patch.position);
    });
    return yield* snapshot;
  });

  const remove = Effect.fn('Accounts.remove')(function* (accountId: unknown) {
    yield* assertChangeable;
    if (typeof accountId !== 'string')
      return yield* new DomainError({ code: 'account_invalid', message: 'Name the account to remove.' });
    yield* attemptSync(() => store.find(accountId));
    yield* forget(accountId);
    yield* definition.dispatch({ type: 'account.removed', accountId }, `account.removed:${accountId}`);
    yield* attempt(() => imports.sync());
    return yield* snapshot;
  });

  return {
    start,
    stop,
    snapshot,
    changed,
    subscribe,
    syncProviderLogins,
    syncSignIns,
    readUsage,
    readProviderUsage,
    lease,
    readWeeklyReading,
    readProviderWeeklyReading,
    readFastMode,
    isProviderRejection,
    recordProviderRejection,
    onNotice,
    refresh,
    refreshUsage,
    startLogin,
    beginLogin,
    finishLogin,
    loginEnded,
    submitLoginCode,
    cancelLogin,
    importAccount,
    update,
    remove,
  };
});
