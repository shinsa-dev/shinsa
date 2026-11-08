import {
  type AccountDuplicate,
  type AccountSummary,
  type AccountsSnapshot,
  CLAUDE_PROVIDER,
  type ChatNotice,
  DomainError,
  type FastModeAvailability,
  isPaceMoved,
  listActiveRuns,
  listOpenGates,
  listProviderPaces,
  type ProviderLogin,
  resolveAgentModel,
  resolveCandidateSpentUntil,
  resolvePlanKey,
  resolveSpentUntil,
  resolveWeeklyReading,
  type ShinsaCommand,
  type WeeklyReading,
} from '@shinsa/core';
import { Clock, Context, Effect, Exit, Fiber, FileSystem, Layer, Ref } from 'effect';
import type {
  AccountLease,
  AccountLeaseRequest,
  RejectionVerdict,
  RunRejection,
} from '../../agents/accounts/schema.ts';
import { resolveClaudeExecutable } from '../../agents/providers/claude/executable.ts';
import { ProgramVersions } from '../../agents/providers/versions/service.ts';
import { EngineConfig } from '../../config/service.ts';
import { createReadOnlyError } from '../../instance/inspect.ts';
import { describeError } from '../../log/redact.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { AccountChanges } from '../changes/service.ts';
import { AccountCommands } from '../command/service.ts';
import { AccountImports } from '../imports/service.ts';
import { UsageLimits } from '../limits/service.ts';
import { LoginFinishFailed, type LoginOutcome } from '../login/schema.ts';
import { AccountLogins } from '../login/service.ts';
import { parseAccountPatch } from '../patch.ts';
import { type Env, resolveAccountEnv } from '../paths.ts';
import { UsageReadings } from '../readings/service.ts';
import type { RenewedLogin } from '../renewal/schema.ts';
import { LoginRenewal } from '../renewal/service.ts';
import { AccountRotation } from '../rotation/service.ts';
import {
  AccountsInput,
  AccountStepFailed,
  type AccountsFailure,
  AccountsRefreshInterval,
  ClaudeCommandPath,
  STATUS_TIMEOUT,
  type StoredAccount,
} from '../schema.ts';
import { AccountSignIns } from '../sign-ins/service.ts';
import { AuthStatusReader } from '../status/service.ts';
import { isSharedLogin } from '../store/identity.ts';
import { AccountStore } from '../store/service.ts';
import { SHARED_LOGIN_DETAIL } from './schema.ts';

export class Accounts extends Context.Service<
  Accounts,
  {
    readonly start: Effect.Effect<void, AccountsFailure>;
    readonly stop: Effect.Effect<void>;
    readonly snapshot: Effect.Effect<AccountsSnapshot>;
    subscribe(
      listener: (snapshot: AccountsSnapshot) => Effect.Effect<void>
    ): Effect.Effect<Effect.Effect<void>>;
    readonly syncProviderLogins: Effect.Effect<void>;
    readonly syncSignIns: Effect.Effect<void>;
    lease(request: AccountLeaseRequest): Effect.Effect<AccountLease | null, DomainError>;
    readWeeklyReading(accountId: string, force: boolean): Effect.Effect<WeeklyReading | null>;
    readProviderWeeklyReading(provider: string, force: boolean): Effect.Effect<WeeklyReading | null>;
    readFastMode(provider: string, accountId?: string | null): Effect.Effect<FastModeAvailability>;
    onRejection(rejection: RunRejection): Effect.Effect<RejectionVerdict>;
    onNotice(runId: string, notice: ChatNotice): Effect.Effect<void>;
    readonly refresh: Effect.Effect<AccountsSnapshot, AccountsFailure>;
    readonly refreshUsage: Effect.Effect<AccountsSnapshot, AccountsFailure>;
    startLogin(accountId: string | null): Effect.Effect<AccountsSnapshot, AccountsFailure>;
    submitLoginCode(loginId: unknown, code: unknown): Effect.Effect<AccountsSnapshot, DomainError>;
    cancelLogin(loginId: unknown): Effect.Effect<AccountsSnapshot, DomainError>;
    importAccount(origin: unknown, email: unknown): Effect.Effect<AccountsSnapshot, AccountsFailure>;
    update(accountId: unknown, patch: unknown): Effect.Effect<AccountsSnapshot, AccountsFailure>;
    remove(accountId: unknown): Effect.Effect<AccountsSnapshot, AccountsFailure>;
  }
>()('shinsa/engine/accounts/roster/Accounts') {
  static readonly layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const store = yield* AccountStore;
      const usage = yield* UsageLimits;
      const limits = usage.claude;
      const providerLimits = usage.providers;
      const readings = yield* UsageReadings;
      const logins = yield* AccountLogins;
      const rotation = yield* AccountRotation;
      const renewal = yield* LoginRenewal;
      const imports = yield* AccountImports;
      const signIns = yield* AccountSignIns;
      const accountChanges = yield* AccountChanges;
      const statuses = yield* AuthStatusReader;
      const commands = yield* AccountCommands;
      const engine = yield* EngineCore;
      const versions = yield* ProgramVersions;
      const input = yield* AccountsInput;
      const claudePath = yield* ClaudeCommandPath;
      const refreshInterval = yield* AccountsRefreshInterval;
      const { inspect, userHome } = yield* EngineConfig;
      const scope = yield* Effect.scope;
      const runFork = Effect.runForkWith(yield* Effect.context<never>());
      const providerIds = new Set(readings.providerIds);
      const providerLogins = yield* Ref.make<ProviderLogin[]>([]);
      const newLogins = yield* Ref.make<ReadonlySet<string>>(new Set());
      const last = yield* Ref.make('');
      const duplicates = yield* Ref.make<ReadonlySet<string>>(new Set());
      const timer = yield* Ref.make<Fiber.Fiber<never> | null>(null);
      const stopped = yield* Ref.make(false);
      const files = yield* FileSystem.FileSystem;
      const listeners = yield* Ref.make<ReadonlySet<(snapshot: AccountsSnapshot) => Effect.Effect<void>>>(
        new Set()
      );

      const resolveClaude =
        claudePath ??
        resolveClaudeExecutable().pipe(
          Effect.provideService(ProgramVersions, versions),
          Effect.provideService(FileSystem.FileSystem, files),
          Effect.flatMap((executable) =>
            executable.ok
              ? Effect.succeed(executable.path)
              : Effect.fail(new DomainError({ code: 'claude_missing', message: executable.message }))
          )
        );

      const dispatch = (command: ShinsaCommand, id: string) =>
        engine.dispatch(command, { id }).pipe(
          Effect.asVoid,
          Effect.catchTag('EngineStopped', (failure) =>
            Effect.fail(new AccountStepFailed({ message: failure.message }))
          )
        );

      const forgetNew = (accountId: string) =>
        Ref.update(newLogins, (ids) => new Set([...ids].filter((id) => id !== accountId)));

      const assertChangeable = Effect.gen(function* () {
        if (inspect) return yield* createReadOnlyError();
      });

      const listIds = Effect.map(store.listDistinct, (accounts) => accounts.map((account) => account.id));

      const listProviderSummaries = Effect.gen(function* () {
        const summaries: ProviderLogin[] = [];
        for (const login of yield* Ref.get(providerLogins)) {
          if (!providerIds.has(login.provider)) {
            summaries.push(login);
            continue;
          }
          const identity = yield* readings.selectProviderIdentity(login.provider);
          summaries.push({
            ...login,
            email: identity?.email ?? null,
            plan: identity?.plan ?? null,
            usage: yield* providerLimits.snapshot(login.provider),
          });
        }
        return summaries;
      });

      const snapshot = Effect.gen(function* () {
        const state = yield* engine.state;
        const now = yield* Clock.currentTimeMillis;
        const runs = new Map<string, number>();
        for (const run of listActiveRuns(state)) {
          const id = run.attempts?.at(-1)?.account?.id;
          if (id) runs.set(id, (runs.get(id) ?? 0) + 1);
        }
        const model = resolveAgentModel(state.settings, 'agent', CLAUDE_PROVIDER);
        const kept = yield* store.resolveDuplicates;
        const accounts: AccountSummary[] = [];
        for (const account of yield* store.listDistinct) {
          const signIn = yield* signIns.select(account.id);
          const accountUsage = yield* limits.snapshot(account.id);
          const marked = yield* rotation.resolveSpentUntil(account.id, false);
          accounts.push({
            id: account.id,
            email: account.email,
            organization: account.organization,
            plan: account.plan,
            origin: account.origin,
            isDefault: yield* store.isDefault(account.id, kept),
            paused: account.paused,
            switchAt: account.switchAt,
            signIn: signIn?.signIn ?? 'unknown',
            signInDetail: signIn?.detail ?? null,
            usage: accountUsage,
            spentUntil: resolveCandidateSpentUntil({ spentUntil: marked, usage: accountUsage }, model, now),
            runs: runs.get(account.id) ?? 0,
          });
        }
        const found = (yield* store.list).flatMap((account): AccountDuplicate[] => {
          const keptId = kept.get(account.id);
          if (!keptId || !account.email) return [];
          return [{ id: account.id, email: account.email, keptId }];
        });
        const answer: AccountsSnapshot = {
          accounts,
          login: yield* logins.current,
          imports: yield* imports.list,
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

      const recordPlan = Effect.fn('Accounts.recordPlan')(function* (account: AccountSummary, seq: number) {
        const plan = resolvePlanKey(account.plan);
        yield* dispatch(
          { type: 'account.plan_recorded', accountId: account.id, provider: CLAUDE_PROVIDER, plan },
          `account-plan:${account.id}:${plan ?? 'none'}:${seq}`
        ).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Accounts] Could not record the plan an account is on').pipe(
              Effect.annotateLogs({ accountId: account.id, error: describeError(failure) })
            )
          )
        );
      });

      const recordPlans = Effect.fn('Accounts.recordPlans')(function* (accounts: AccountSummary[]) {
        if (inspect) return;
        const state = yield* engine.state;
        const changedPlans = accounts.filter(
          (account) => (state.accountPlans[account.id]?.plan ?? null) !== resolvePlanKey(account.plan)
        );
        for (const account of changedPlans) yield* recordPlan(account, state.seq);
      });

      const recordPaces = Effect.fn('Accounts.recordPaces')(function* (next: AccountsSnapshot) {
        if (inspect) return;
        const state = yield* engine.state;
        const now = yield* Clock.currentTimeMillis;
        const moved = listProviderPaces(next, now).filter(({ provider, pace }) =>
          isPaceMoved(state.usagePaces[provider]?.pace ?? null, pace)
        );
        for (const { provider, pace } of moved) {
          yield* dispatch(
            { type: 'usage.pace_recorded', provider, pace },
            `usage-pace:${provider}:${pace ?? 'none'}:${state.seq}`
          ).pipe(
            Effect.catch((failure) =>
              Effect.logWarning('[Accounts] Could not record the safe usage pace').pipe(
                Effect.annotateLogs({ provider, error: describeError(failure) })
              )
            )
          );
        }
      });

      const changed = Effect.gen(function* () {
        if (yield* Ref.get(stopped)) return;
        const next = yield* snapshot;
        const serialized = JSON.stringify(next);
        if (serialized === (yield* Ref.getAndSet(last, serialized))) return;
        yield* recordDuplicates(next.duplicates ?? []);
        for (const listener of yield* Ref.get(listeners)) yield* listener(next);
        yield* recordPlans(next.accounts);
        yield* recordPaces(next);
      });

      const subscribe = (listener: (snapshot: AccountsSnapshot) => Effect.Effect<void>) =>
        Effect.as(
          Ref.update(listeners, (all) => new Set(all).add(listener)),
          Ref.update(listeners, (all) => new Set([...all].filter((candidate) => candidate !== listener)))
        );

      const syncImports = Effect.andThen(imports.sync, changed);

      const readStatus = Effect.fn('Accounts.readStatus')(function* (env: Env) {
        return yield* statuses.read(yield* resolveClaude, env);
      });

      const refreshLimits = Effect.fn('Accounts.refreshLimits')(function* (force: boolean) {
        yield* limits.refresh(yield* listIds, force);
      });

      const refreshProviderUsage = (force: boolean) => providerLimits.refresh(readings.providerIds, force);

      const answerProviderSignIns = Effect.gen(function* () {
        for (const login of yield* Ref.get(providerLogins)) {
          if (login.status !== 'signed_in') continue;
          const gates = listOpenGates(yield* engine.state).filter(
            (gate) => gate.type === 'sign_in' && gate.provider === login.provider && !gate.account
          );
          if (gates.length === 0) continue;
          const ids = gates.map((gate) => gate.id).join(',');
          yield* dispatch(
            { type: 'provider.record_sign_in', provider: login.provider },
            `provider-login:${login.provider}:${ids}`
          ).pipe(
            Effect.catch((failure) =>
              Effect.logWarning('[Accounts] Could not carry on after a provider sign-in').pipe(
                Effect.annotateLogs({ provider: login.provider, error: describeError(failure) })
              )
            )
          );
        }
      });

      const syncProviderLogins = Effect.gen(function* () {
        yield* input.listProviderLogins.pipe(
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
          yield* signIns.record(account.id, {
            signIn: 'signed_out',
            detail: SHARED_LOGIN_DETAIL[account.origin],
          });
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
        yield* signIns.record(account.id, { signIn: status.signIn, detail: status.detail });
        if (status.signIn === 'signed_in')
          yield* store.update(account.id, {
            email: status.email ?? account.email,
            organization: status.organization ?? account.organization,
            plan: account.plan ?? status.plan,
          });
        yield* changed;
      });

      const syncSignIns = Effect.gen(function* () {
        yield* Effect.forEach(yield* store.list, syncSignIn, { concurrency: 'unbounded', discard: true });
      });

      const resumeOne = Effect.fn('Accounts.resumeOne')(function* ({ account, fingerprint }: RenewedLogin) {
        yield* signIns.record(account.id, { signIn: 'signed_in', detail: null });
        yield* Effect.logInfo('[Accounts] A login that needed signing in works again; carrying on').pipe(
          Effect.annotateLogs({ accountId: account.id, email: account.email })
        );
        yield* dispatch(
          { type: 'account.signed_in', account: { id: account.id, email: account.email } },
          `login-renewed:${account.id}:${fingerprint}`
        ).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Accounts] Could not carry on after a login works again').pipe(
              Effect.annotateLogs({ accountId: account.id, error: describeError(failure) })
            )
          )
        );
      });

      const resumeRenewed = Effect.gen(function* () {
        const own = (yield* store.list).filter((account) => !isSharedLogin(account));
        const renewed = yield* renewal.listRenewed(own);
        yield* Effect.forEach(renewed, resumeOne, { concurrency: 'unbounded', discard: true });
        if (renewed.length > 0) yield* changed;
      });

      const tick = Effect.all(
        [refreshLimits(false), refreshProviderUsage(false), syncProviderLogins, resumeRenewed],
        {
          concurrency: 'unbounded',
          discard: true,
        }
      );

      const settleAll = Effect.fn('Accounts.settleAll')(function* (
        steps: ReadonlyArray<Effect.Effect<void, AccountsFailure>>
      ) {
        const exits = yield* Effect.forEach(steps, Effect.exit, { concurrency: 'unbounded' });
        const failed = exits.find(Exit.isFailure);
        if (failed) return yield* Effect.failCause(failed.cause);
      });

      const start = Effect.gen(function* () {
        if (inspect) return yield* changed;
        yield* settleAll([syncSignIns, syncImports, syncProviderLogins]);
        yield* settleAll([refreshLimits(false), refreshProviderUsage(false)]);
        if (yield* Ref.get(stopped)) return;
        const fiber = yield* Effect.forkIn(Effect.forever(Effect.delay(tick, refreshInterval)), scope);
        yield* Ref.set(timer, fiber);
        yield* changed;
      });

      const stop = Effect.gen(function* () {
        yield* Ref.set(stopped, true);
        const fiber = yield* Ref.getAndSet(timer, null);
        if (fiber) yield* Effect.forkDetach(Fiber.interrupt(fiber));
        yield* logins.stop;
      });

      const readWeeklyReading = Effect.fn('Accounts.readWeeklyReading')(function* (
        accountId: string,
        force: boolean
      ) {
        const pushed = (yield* limits.snapshot(accountId)).source === 'push';
        yield* limits.refresh([accountId], force || pushed);
        return resolveWeeklyReading(yield* limits.snapshot(accountId));
      });

      const readProviderWeeklyReading = Effect.fn('Accounts.readProviderWeeklyReading')(function* (
        provider: string,
        force: boolean
      ) {
        if (!providerIds.has(provider)) return null;
        const pushed = (yield* providerLimits.snapshot(provider)).source === 'push';
        yield* providerLimits.refresh([provider], force || pushed);
        return resolveWeeklyReading(yield* providerLimits.snapshot(provider));
      });

      const readFastMode = Effect.fn('Accounts.readFastMode')(function* (
        provider: string,
        accountId: string | null = null
      ) {
        const unknown: FastModeAvailability = 'unknown';
        if (accountId === null && providerIds.has(provider)) {
          yield* providerLimits.refresh([provider], false);
          return (yield* providerLimits.snapshot(provider)).fastMode ?? unknown;
        }
        if (provider !== CLAUDE_PROVIDER || accountId === null) return unknown;
        yield* limits.refresh([accountId], false);
        return (yield* limits.snapshot(accountId)).fastMode ?? unknown;
      });

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
          const email = (yield* readings.selectProviderIdentity(provider))?.email ?? null;
          const verdict: RejectionVerdict = {
            retry: false,
            failure: { ...failure, login: { provider, email } },
          };
          return verdict;
        }
        if (failure.class !== 'usage_limit') return refused;
        if (failure.resetAt !== null) {
          yield* Effect.forkDetach(refreshProviderUsage(true));
          return refused;
        }
        const model = (yield* engine.state).runs[rejection.runId]?.model ?? null;
        const pushed = resolveSpentUntil(
          yield* providerLimits.snapshot(provider),
          model,
          yield* Clock.currentTimeMillis
        );
        if (pushed !== null) {
          const verdict: RejectionVerdict = { retry: false, failure: { ...failure, resetAt: pushed } };
          return verdict;
        }
        yield* refreshProviderUsage(true);
        const resetAt = resolveSpentUntil(
          yield* providerLimits.snapshot(provider),
          model,
          yield* Clock.currentTimeMillis
        );
        const verdict: RejectionVerdict = { retry: false, failure: { ...failure, resetAt } };
        return verdict;
      });

      const onRejection = Effect.fn('Accounts.onRejection')(function* (rejection: RunRejection) {
        if (rejection.accountId === null && providerIds.has(rejection.provider))
          return yield* recordProviderRejection(rejection);
        return yield* rotation.recordRejection(rejection);
      });

      const onNotice = Effect.fn('Accounts.onNotice')(function* (runId: string, notice: ChatNotice) {
        yield* input.forward(runId, notice);
        const latest = (yield* engine.state).runs[runId]?.attempts?.at(-1);
        const accountId = latest?.account?.id;
        if (!accountId) {
          if (notice.kind === 'rate_limit' && latest && providerIds.has(latest.provider))
            yield* providerLimits.recordPush(latest.provider, notice);
          return;
        }
        if (notice.kind === 'rate_limit') return yield* limits.recordPush(accountId, notice);
        if (notice.kind !== 'account' || !notice.email) return;
        const account = yield* store.select(accountId);
        if (!account) return;
        yield* signIns.record(accountId, { signIn: 'signed_in', detail: null });
        yield* store.update(accountId, {
          email: notice.email,
          organization: notice.organization ?? account.organization,
          plan: notice.plan ?? account.plan,
        });
        yield* changed;
      });

      const refresh = Effect.gen(function* () {
        yield* assertChangeable;
        yield* settleAll([syncSignIns, syncImports, syncProviderLogins]);
        yield* resumeRenewed;
        yield* settleAll([refreshLimits(true), refreshProviderUsage(true)]);
        return yield* snapshot;
      });

      const refreshUsage = Effect.gen(function* () {
        yield* assertChangeable;
        yield* settleAll([refreshLimits(false), refreshProviderUsage(false)]);
        return yield* snapshot;
      });

      const signOutFolder = Effect.fn('Accounts.signOutFolder')(function* (account: StoredAccount) {
        if (!account.configDir) return;
        const claude = yield* resolveClaude;
        const result = yield* commands.run([claude, 'auth', 'logout'], userHome, {
          env: resolveAccountEnv(account.configDir),
          timeout: STATUS_TIMEOUT,
        });
        if (result.ok) return;
        yield* Effect.logWarning('[Accounts] Could not sign an account’s folder out').pipe(
          Effect.annotateLogs({ accountId: account.id, code: result.code })
        );
      });

      const finishLogin = Effect.fn('Accounts.finishLogin')(function* (accountId: string, loginId: string) {
        const account = yield* store.select(accountId);
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
            yield* signIns.record(accountId, { signIn: 'signed_out', detail: message });
            yield* changed;
          }
          return outcome(message);
        }
        if ((yield* store.selectByIdentity(status, accountId)) && isNew)
          return outcome(`${status.email} is already added.`);
        yield* store.update(accountId, {
          email: status.email ?? account.email,
          organization: status.organization ?? account.organization,
          plan: account.plan ?? status.plan,
          origin: 'login',
        });
        yield* signIns.record(accountId, { signIn: 'signed_in', detail: null });
        yield* rotation.clear(accountId);
        yield* renewal.clear(accountId);
        yield* forgetNew(accountId);
        yield* dispatch(
          { type: 'account.signed_in', account: { id: accountId, email: status.email ?? account.email } },
          `login:${loginId}:account.signed_in`
        );
        yield* limits.refresh([accountId], true);
        yield* syncImports;
        const signedIn: LoginOutcome = { ok: true, email: status.email };
        return signedIn;
      });

      const forget = Effect.fn('Accounts.forget')(function* (accountId: string) {
        yield* signOutFolder(yield* store.find(accountId));
        yield* store.remove(accountId);
        yield* limits.remove(accountId);
        yield* signIns.remove(accountId);
        yield* rotation.clear(accountId);
        yield* renewal.clear(accountId);
        yield* forgetNew(accountId);
      });

      const loginEnded = Effect.fn('Accounts.loginEnded')(function* (accountId: string, done: boolean) {
        if (done || !(yield* Ref.get(newLogins)).has(accountId)) return;
        yield* forgetNew(accountId);
        yield* Effect.forkDetach(
          forget(accountId).pipe(
            Effect.andThen(syncImports),
            Effect.catch((failure) =>
              Effect.logWarning('[Accounts] Could not clear an account that never signed in').pipe(
                Effect.annotateLogs({ accountId, error: describeError(failure) })
              )
            )
          )
        );
      });

      const beginLogin = Effect.fn('Accounts.beginLogin')(function* (
        existing: StoredAccount | null,
        email: string | null
      ) {
        const claude = yield* resolveClaude;
        const account = existing ? yield* store.createFolder(existing.id) : yield* store.create({ email });
        if (!account?.configDir) return;
        if (!existing) yield* Ref.update(newLogins, (ids) => new Set(ids).add(account.id));
        const configDir = account.configDir;
        yield* logins.start({
          accountId: account.id,
          claude,
          cwd: configDir,
          env: resolveAccountEnv(configDir),
          email: account.email,
          finish: (loginId) =>
            finishLogin(account.id, loginId).pipe(
              Effect.mapError((failure) => new LoginFinishFailed({ message: describeError(failure) }))
            ),
          ended: (login) => loginEnded(login.accountId, login.phase === 'done'),
        });
      });

      const startLogin = Effect.fn('Accounts.startLogin')(function* (accountId: string | null) {
        yield* assertChangeable;
        const existing = accountId ? yield* store.find(accountId) : null;
        yield* beginLogin(existing, null);
        return yield* snapshot;
      });

      const submitLoginCode = Effect.fn('Accounts.submitLoginCode')(function* (
        loginId: unknown,
        code: unknown
      ) {
        if (typeof loginId !== 'string' || typeof code !== 'string' || !code.trim())
          return yield* new DomainError({
            code: 'code_invalid',
            message: 'Paste the code the sign-in page showed.',
          });
        if (!(yield* logins.submitCode(loginId, code)))
          return yield* new DomainError({
            code: 'login_stale',
            message: 'That sign-in ended. Start it again.',
          });
        return yield* snapshot;
      });

      const cancelLogin = Effect.fn('Accounts.cancelLogin')(function* (loginId: unknown) {
        if (typeof loginId !== 'string')
          return yield* new DomainError({ code: 'login_invalid', message: 'Name the sign-in to cancel.' });
        const phase = (yield* logins.current)?.phase;
        if (phase === 'done' || phase === 'failed') yield* logins.clear(loginId);
        else yield* logins.cancel(loginId);
        return yield* snapshot;
      });

      const importAccount = Effect.fn('Accounts.importAccount')(function* (origin: unknown, email: unknown) {
        yield* assertChangeable;
        yield* beginLogin(null, yield* imports.resolveImportEmail(origin, email));
        return yield* snapshot;
      });

      const update = Effect.fn('Accounts.update')(function* (accountId: unknown, patchBody: unknown) {
        yield* assertChangeable;
        if (typeof accountId !== 'string')
          return yield* new DomainError({ code: 'account_invalid', message: 'Name the account to change.' });
        const account = yield* store.find(accountId);
        const patch = yield* Effect.fromResult(parseAccountPatch(patchBody));
        if (patch.isDefault) yield* store.updateDefault(account.id);
        if (patch.paused !== undefined) yield* store.update(account.id, { paused: patch.paused });
        if (patch.switchAt !== undefined) yield* store.update(account.id, { switchAt: patch.switchAt });
        if (patch.position !== undefined) yield* store.move(account.id, patch.position);
        return yield* snapshot;
      });

      const remove = Effect.fn('Accounts.remove')(function* (accountId: unknown) {
        yield* assertChangeable;
        if (typeof accountId !== 'string')
          return yield* new DomainError({ code: 'account_invalid', message: 'Name the account to remove.' });
        yield* store.find(accountId);
        yield* forget(accountId);
        yield* dispatch({ type: 'account.removed', accountId }, `account.removed:${accountId}`);
        yield* syncImports;
        return yield* snapshot;
      });

      yield* accountChanges.listen(changed);
      yield* engine.observe(() => {
        runFork(changed);
      });

      return Accounts.of({
        start,
        stop,
        snapshot,
        subscribe,
        syncProviderLogins,
        syncSignIns,
        lease: rotation.lease,
        readWeeklyReading,
        readProviderWeeklyReading,
        readFastMode,
        onRejection,
        onNotice,
        refresh,
        refreshUsage,
        startLogin,
        submitLoginCode,
        cancelLogin,
        importAccount,
        update,
        remove,
      });
    })
  );
}
