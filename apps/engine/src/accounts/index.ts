import { join } from 'node:path';
import {
  type AccountDuplicate,
  type AccountOrigin,
  type AccountSummary,
  type AccountsSnapshot,
  type ChatNotice,
  CLAUDE_PROVIDER,
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
import type { AccountLease, AccountLeaseRequest, RejectionVerdict, RunRejection } from '../agents/index.ts';
import { resolveClaudeExecutable } from '../agents/providers/claude/executable.ts';
import type { ProviderUsageSource } from '../agents/providers/index.ts';
import type { ServerConfig } from '../config/index.ts';
import { createReadOnlyError } from '../instance/index.ts';
import { describeError, log } from '../log/index.ts';
import { type AccountSource, createSummaryAccountSource } from '../onboarding/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { runCommand } from '../shell/index.ts';
import { createKeychainReader, readStoredLogin, type SecretReader } from './credentials.ts';
import { Cswap } from './cswap.ts';
import { AccountImports } from './imports.ts';
import { UsageLimits } from './limits.ts';
import {
  AccountLogins,
  type LoginFinisher,
  type LoginSpawner,
  type LoginTimers,
  spawnLoginTerminal,
} from './login.ts';
import { parseAccountPatch } from './patch.ts';
import { type Env, resolveAccountEnv, resolveSharedConfigDir, resolveSharedGlobalConfig } from './paths.ts';
import { LoginRenewal, type RenewedLogin } from './renewal.ts';
import { AccountRotation, type SignInState } from './rotation.ts';
import { type AuthStatus, type ClaudeRunner, readAuthStatus, STATUS_TIMEOUT_MS } from './status.ts';
import { AccountStore, isSharedLogin, type StoredAccount } from './store.ts';
import { EXPIRED_READ, PROVIDER_WINDOWS, requestUsage, type UsageRequester } from './usage.ts';

export { UsageResumeClock } from './resume.ts';

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

interface ProviderIdentity {
  email: string | null;
  plan: string | null;
}

const REFRESH_INTERVAL_MS = 5 * 60_000;

const SHARED_LOGIN_DETAIL: Record<Exclude<AccountOrigin, 'login'>, string> = {
  cswap:
    'Shinsa holds a copy of claude-swap’s login for this account, so each one signs the other out. Sign in again to give Shinsa a login of its own.',
  claude:
    'Shinsa runs this account on your Claude Code login, which Claude Code and claude-swap change and refresh too. Sign in again to give Shinsa a login of its own.',
};

async function resolveClaudePath() {
  const executable = await resolveClaudeExecutable();
  if (!executable.ok) throw new DomainError('claude_missing', executable.message);
  return executable.path;
}

export class Accounts {
  readonly store: AccountStore;
  readonly limits: UsageLimits;
  readonly providerLimits: UsageLimits;
  readonly logins: AccountLogins;
  readonly #engine: Engine;
  readonly #config: ServerConfig;
  readonly #env: Env;
  readonly #run: ClaudeRunner;
  readonly #readSecret: SecretReader;
  readonly #requestHttp: UsageRequester | undefined;
  readonly #resolveClaude: () => Promise<string>;
  readonly #now: () => number;
  readonly #refreshIntervalMs: number;
  readonly #forward: ((runId: string, notice: ChatNotice) => void) | null;
  readonly #readProviderLogins: () => Promise<ProviderLogin[]>;
  #providerLogins: ProviderLogin[] = [];
  readonly #providerUsage: Map<string, ProviderUsageSource>;
  readonly #providerIdentities = new Map<string, ProviderIdentity>();
  readonly #signIns = new Map<string, SignInState>();
  readonly #rotation: AccountRotation;
  readonly #renewal: LoginRenewal;
  readonly #imports: AccountImports;
  readonly #newLogins = new Set<string>();
  readonly #listeners = new Set<(snapshot: AccountsSnapshot) => void>();
  #last = '';
  #duplicates = new Set<string>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #unsubscribers: (() => void)[] = [];
  #stopped = false;

  constructor(options: AccountsOptions) {
    this.#engine = options.engine;
    this.#config = options.config;
    this.#env = options.env ?? Bun.env;
    this.#run = options.run ?? runCommand;
    this.#readSecret = options.readSecret ?? createKeychainReader();
    this.#requestHttp = options.requestHttp;
    this.#resolveClaude = options.resolveClaude ?? resolveClaudePath;
    this.#now = options.now ?? Date.now;
    this.#refreshIntervalMs = options.refreshIntervalMs ?? REFRESH_INTERVAL_MS;
    this.#forward = options.forward ?? null;
    this.#readProviderLogins = options.providerLogins ?? (() => Promise.resolve([]));
    this.#providerUsage = new Map((options.providerUsage ?? []).map((source) => [source.id, source]));
    const userHome = options.config.userHome;
    this.store = new AccountStore({
      home: options.config.home,
      sharedDir: resolveSharedConfigDir(this.#env, userHome),
      sharedGlobalConfig: resolveSharedGlobalConfig(this.#env, userHome),
      now: this.#now,
    });
    this.limits = new UsageLimits({
      path: join(options.config.dataDir, 'usage-limits.json'),
      read: (accountId) => this.#readUsage(accountId),
      now: this.#now,
    });
    this.providerLimits = new UsageLimits({
      path: join(options.config.dataDir, 'provider-usage.json'),
      read: (provider) => this.#readProviderUsage(provider),
      now: this.#now,
      windows: PROVIDER_WINDOWS,
      emptyDetail: 'No usage limits reported for this sign-in.',
    });
    this.logins = new AccountLogins({
      spawn: options.spawnLogin ?? spawnLoginTerminal,
      finish: this.#finishLogin,
      onChange: () => this.#changed(),
      onEnded: (login) => this.#loginEnded(login.accountId, login.phase === 'done'),
      now: this.#now,
      timers: options.loginTimers,
    });
    this.#renewal = new LoginRenewal({
      env: this.#env,
      userHome,
      readSecret: this.#readSecret,
      now: this.#now,
    });
    this.#rotation = new AccountRotation({
      store: this.store,
      limits: this.limits,
      renewal: this.#renewal,
      signIns: this.#signIns,
      state: () => this.#engine.state,
      now: this.#now,
      onChange: () => this.#changed(),
      marksPath: join(options.config.dataDir, 'account-marks.json'),
    });
    this.#imports = new AccountImports({
      store: this.store,
      cswap: options.cswap ?? new Cswap({ run: this.#run }),
      signIn: (email) => this.#beginLogin(null, email),
      onChange: () => this.#changed(),
    });
  }

  async start() {
    if (this.#config.inspect) {
      this.#subscribe();
      this.#changed();
      return;
    }
    this.#subscribe();
    await Promise.all([this.syncSignIns(), this.#imports.sync(), this.syncProviderLogins()]);
    await Promise.all([this.limits.refresh(this.#listIds()), this.#refreshProviderUsage()]);
    if (this.#stopped) return;
    this.#timer = setInterval(() => {
      void this.limits.refresh(this.#listIds());
      void this.#refreshProviderUsage();
      void this.syncProviderLogins();
      void this.#resumeRenewed();
    }, this.#refreshIntervalMs);
    this.#timer.unref();
    this.#changed();
  }

  #subscribe() {
    this.#unsubscribers.push(
      this.store.subscribe(() => this.#changed()),
      this.limits.subscribe(() => this.#changed()),
      this.providerLimits.subscribe(() => this.#changed()),
      this.#engine.subscribe(() => this.#changed())
    );
  }

  stop() {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
    this.logins.stop();
  }

  #listIds() {
    return this.store.listDistinct().map((account) => account.id);
  }

  async #status(env: Env): Promise<AuthStatus> {
    const claude = await this.#resolveClaude();
    return readAuthStatus(this.#run, claude, env, this.#config.userHome);
  }

  async syncProviderLogins() {
    try {
      this.#providerLogins = await this.#readProviderLogins();
    } catch (error) {
      log.warn('[Accounts] Could not check the other providers’ sign-ins', { error: describeError(error) });
    }
    await this.#answerProviderSignIns();
    this.#changed();
  }

  #refreshProviderUsage(force = false) {
    return this.providerLimits.refresh([...this.#providerUsage.keys()], force);
  }

  async #readProviderUsage(provider: string) {
    const source = this.#providerUsage.get(provider);
    if (!source) throw new Error(`Shinsa reads no usage for ${provider}.`);
    const reading = await source.read();
    const known = this.#providerIdentities.get(provider);
    this.#providerIdentities.set(provider, {
      email: reading.email ?? known?.email ?? null,
      plan: reading.plan ?? known?.plan ?? null,
    });
    return reading.read;
  }

  async #answerProviderSignIns() {
    for (const login of this.#providerLogins) {
      if (login.status !== 'signed_in') continue;
      const gates = listOpenGates(this.#engine.state).filter(
        (gate) => gate.type === 'sign_in' && gate.provider === login.provider && !gate.account
      );
      if (gates.length === 0) continue;
      const ids = gates.map((gate) => gate.id).join(',');
      try {
        await this.#engine.dispatch(
          { type: 'provider.record_sign_in', provider: login.provider },
          { id: `provider-login:${login.provider}:${ids}` }
        );
      } catch (error) {
        log.warn('[Accounts] Could not carry on after a provider sign-in', {
          provider: login.provider,
          error: describeError(error),
        });
      }
    }
  }

  #listProviderSummaries(): ProviderLogin[] {
    return this.#providerLogins.map((login) => {
      if (!this.#providerUsage.has(login.provider)) return login;
      const identity = this.#providerIdentities.get(login.provider);
      return {
        ...login,
        email: identity?.email ?? null,
        plan: identity?.plan ?? null,
        usage: this.providerLimits.snapshot(login.provider),
      };
    });
  }

  async syncSignIns() {
    await Promise.all(this.store.list().map((account) => this.#syncSignIn(account)));
  }

  async #syncSignIn(account: StoredAccount) {
    if (account.origin !== 'login') {
      this.#signIns.set(account.id, { signIn: 'signed_out', detail: SHARED_LOGIN_DETAIL[account.origin] });
      this.#changed();
      return;
    }
    let status: AuthStatus;
    try {
      status = await this.#status(resolveAccountEnv(account.configDir));
    } catch (error) {
      this.#signIns.set(account.id, { signIn: 'unknown', detail: describeError(error) });
      this.#changed();
      return;
    }
    this.#signIns.set(account.id, { signIn: status.signIn, detail: status.detail });
    if (status.signIn === 'signed_in') {
      this.store.update(account.id, {
        email: status.email ?? account.email,
        organization: status.organization ?? account.organization,
        plan: account.plan ?? status.plan,
      });
    }
    this.#changed();
  }

  async #readUsage(accountId: string) {
    const account = this.store.select(accountId);
    if (!account)
      return {
        ok: false as const,
        reason: 'failed' as const,
        detail: 'The account was removed.',
        retryAfterMs: null,
      };
    const login = await readStoredLogin({
      configDir: account.configDir,
      env: this.#env,
      userHome: this.#config.userHome,
      readSecret: this.#readSecret,
    });
    if (!login) {
      return {
        ok: false as const,
        reason: 'expired' as const,
        detail: 'Shinsa could not find this account’s login. Sign in again.',
        retryAfterMs: null,
      };
    }
    if (login.plan && !account.plan) this.store.update(account.id, { plan: login.plan });
    if (login.expiresAt !== null && login.expiresAt <= this.#now()) return EXPIRED_READ;
    return requestUsage(login.accessToken, this.#requestHttp);
  }

  subscribe(listener: (snapshot: AccountsSnapshot) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #changed() {
    const snapshot = this.snapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.#last) return;
    this.#last = serialized;
    this.#recordDuplicates(snapshot.duplicates ?? []);
    for (const listener of this.#listeners) listener(snapshot);
  }

  #recordDuplicates(duplicates: AccountDuplicate[]) {
    const ids = new Set(duplicates.map((duplicate) => duplicate.id));
    for (const duplicate of duplicates) {
      if (this.#duplicates.has(duplicate.id)) continue;
      log.info('[Accounts] Two accounts hold the same login; Shinsa uses one and leaves the other alone', {
        accountId: duplicate.id,
        keptId: duplicate.keptId,
        email: duplicate.email,
      });
    }
    this.#duplicates = ids;
  }

  #countRuns() {
    const counts = new Map<string, number>();
    for (const run of listActiveRuns(this.#engine.state)) {
      const id = run.attempts?.at(-1)?.account?.id;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  snapshot(): AccountsSnapshot {
    const runs = this.#countRuns();
    const now = this.#now();
    const model = resolveAgentModel(this.#engine.state.settings, 'agent', CLAUDE_PROVIDER);
    const duplicates = this.store.resolveDuplicates();
    const accounts = this.store.listDistinct().map((account): AccountSummary => {
      const signIn = this.#signIns.get(account.id);
      const usage = this.limits.snapshot(account.id);
      const marked = this.#rotation.resolveSpentUntil(account.id);
      return {
        id: account.id,
        email: account.email,
        organization: account.organization,
        plan: account.plan,
        origin: account.origin,
        isDefault: this.store.isDefault(account.id, duplicates),
        paused: account.paused,
        switchAt: account.switchAt,
        signIn: signIn?.signIn ?? 'unknown',
        signInDetail: signIn?.detail ?? null,
        usage,
        spentUntil: resolveCandidateSpentUntil({ spentUntil: marked, usage }, model, now),
        runs: runs.get(account.id) ?? 0,
      };
    });
    return {
      accounts,
      login: this.logins.current(),
      imports: this.#imports.list(),
      duplicates: this.#listDuplicates(duplicates),
      providers: this.#listProviderSummaries(),
    };
  }

  #listDuplicates(duplicates: Map<string, string>): AccountDuplicate[] {
    return this.store.list().flatMap((account) => {
      const keptId = duplicates.get(account.id);
      if (!keptId || !account.email) return [];
      return [{ id: account.id, email: account.email, keptId }];
    });
  }

  lease(request: AccountLeaseRequest): Promise<AccountLease | null> {
    return Promise.resolve(this.#rotation.lease(request));
  }

  async readWeeklyReading(accountId: string, force: boolean) {
    const pushed = this.limits.snapshot(accountId).source === 'push';
    await this.limits.refresh([accountId], force || pushed);
    return resolveWeeklyReading(this.limits.snapshot(accountId));
  }

  async readProviderWeeklyReading(provider: string, force: boolean) {
    if (!this.#providerUsage.has(provider)) return null;
    const pushed = this.providerLimits.snapshot(provider).source === 'push';
    await this.providerLimits.refresh([provider], force || pushed);
    return resolveWeeklyReading(this.providerLimits.snapshot(provider));
  }

  async readFastMode(provider: string, accountId: string | null): Promise<FastModeAvailability> {
    if (accountId === null && this.#providerUsage.has(provider)) {
      await this.providerLimits.refresh([provider]);
      return this.providerLimits.snapshot(provider).fastMode ?? 'unknown';
    }
    if (provider !== CLAUDE_PROVIDER) return 'unknown';
    if (accountId === null) return 'unknown';
    await this.limits.refresh([accountId]);
    return this.limits.snapshot(accountId).fastMode ?? 'unknown';
  }

  readQuickFastMode = (provider: string) => this.readFastMode(provider, null);

  onRejection = (rejection: RunRejection): Promise<RejectionVerdict> | RejectionVerdict => {
    if (rejection.accountId === null && this.#providerUsage.has(rejection.provider))
      return this.#recordProviderRejection(rejection);
    return this.#rotation.recordRejection(rejection);
  };

  async #recordProviderRejection(rejection: RunRejection): Promise<RejectionVerdict> {
    const { failure, provider } = rejection;
    if (failure.class === 'auth') {
      this.#markProviderSignedOut(provider, failure.message);
      const email = this.#providerIdentities.get(provider)?.email ?? null;
      return { retry: false, failure: { ...failure, login: { provider, email } } };
    }
    if (failure.class !== 'usage_limit') return { retry: false };
    if (failure.resetAt !== null) {
      void this.#refreshProviderUsage(true);
      return { retry: false };
    }
    const model = this.#engine.state.runs[rejection.runId]?.model ?? null;
    const pushed = resolveSpentUntil(this.providerLimits.snapshot(provider), model, this.#now());
    if (pushed !== null) return { retry: false, failure: { ...failure, resetAt: pushed } };
    await this.#refreshProviderUsage(true);
    const resetAt = resolveSpentUntil(this.providerLimits.snapshot(provider), model, this.#now());
    return { retry: false, failure: { ...failure, resetAt } };
  }

  #markProviderSignedOut(provider: string, detail: string) {
    this.#providerLogins = this.#providerLogins.map((login) =>
      login.provider === provider ? { ...login, status: 'signed_out', detail } : login
    );
    this.#changed();
  }

  onNotice = (runId: string, notice: ChatNotice) => {
    this.#forward?.(runId, notice);
    const attempt = this.#engine.state.runs[runId]?.attempts?.at(-1);
    const accountId = attempt?.account?.id;
    if (!accountId) {
      if (notice.kind === 'rate_limit' && attempt && this.#providerUsage.has(attempt.provider))
        this.providerLimits.recordPush(attempt.provider, notice);
      return;
    }
    if (notice.kind === 'rate_limit') {
      this.limits.recordPush(accountId, notice);
      return;
    }
    if (notice.kind !== 'account' || !notice.email) return;
    const account = this.store.select(accountId);
    if (!account) return;
    this.#signIns.set(accountId, { signIn: 'signed_in', detail: null });
    this.store.update(accountId, {
      email: notice.email,
      organization: notice.organization ?? account.organization,
      plan: notice.plan ?? account.plan,
    });
    this.#changed();
  };

  async #resumeRenewed() {
    let renewed: RenewedLogin[];
    try {
      renewed = await this.#renewal.listRenewed(
        this.store.list().filter((account) => !isSharedLogin(account))
      );
    } catch (error) {
      log.warn('[Accounts] Could not check the logins that needed signing in', {
        error: describeError(error),
      });
      return;
    }
    await Promise.all(
      renewed.map(async ({ account, fingerprint }) => {
        this.#signIns.set(account.id, { signIn: 'signed_in', detail: null });
        log.info('[Accounts] A login that needed signing in works again; carrying on', {
          accountId: account.id,
          email: account.email,
        });
        try {
          await this.#engine.dispatch(
            { type: 'account.signed_in', account: { id: account.id, email: account.email } },
            { id: `login-renewed:${account.id}:${fingerprint}` }
          );
        } catch (error) {
          log.warn('[Accounts] Could not carry on after a login works again', {
            accountId: account.id,
            error: describeError(error),
          });
        }
      })
    );
    if (renewed.length > 0) this.#changed();
  }

  async refresh() {
    this.#assertChangeable();
    await Promise.all([this.syncSignIns(), this.#imports.sync(), this.syncProviderLogins()]);
    await this.#resumeRenewed();
    await Promise.all([this.limits.refresh(this.#listIds(), true), this.#refreshProviderUsage(true)]);
    return this.snapshot();
  }

  async refreshUsage() {
    this.#assertChangeable();
    await Promise.all([this.limits.refresh(this.#listIds()), this.#refreshProviderUsage()]);
    return this.snapshot();
  }

  #assertChangeable() {
    if (!this.#config.inspect) return;
    throw createReadOnlyError();
  }

  async startLogin(accountId: string | null) {
    this.#assertChangeable();
    await this.#beginLogin(accountId ? this.store.find(accountId) : null, null);
    return this.snapshot();
  }

  async #beginLogin(existing: StoredAccount | null, email: string | null) {
    const claude = await this.#resolveClaude();
    const account = existing ? this.store.createFolder(existing.id) : this.store.create({ email });
    if (!account?.configDir) return;
    if (!existing) this.#newLogins.add(account.id);
    this.logins.start({
      accountId: account.id,
      claude,
      cwd: account.configDir,
      env: resolveAccountEnv(account.configDir),
      email: account.email,
    });
  }

  #finishLogin: LoginFinisher = async (accountId, loginId) => {
    const account = this.store.select(accountId);
    if (!account) return { ok: false, message: 'The account was removed while you signed in.' };
    const status = await this.#status(resolveAccountEnv(account.configDir));
    if (status.signIn !== 'signed_in') {
      return { ok: false, message: 'Sign-in finished, but Claude still reports this account as signed out.' };
    }
    const isNew = this.#newLogins.has(accountId);
    if (account.email && status.email?.toLowerCase() !== account.email.toLowerCase()) {
      const message = `You signed in as ${status.email ?? 'another account'}, not ${account.email}. Sign in as ${account.email} instead.`;
      if (!isNew) {
        await this.#signOutFolder(account);
        this.#signIns.set(accountId, { signIn: 'signed_out', detail: message });
        this.#changed();
      }
      return { ok: false, message };
    }
    const twin = this.store.selectByIdentity(status, accountId);
    if (twin && isNew) {
      return { ok: false, message: `${status.email} is already added.` };
    }
    this.store.update(accountId, {
      email: status.email ?? account.email,
      organization: status.organization ?? account.organization,
      plan: account.plan ?? status.plan,
      origin: 'login',
    });
    this.#signIns.set(accountId, { signIn: 'signed_in', detail: null });
    this.#rotation.clear(accountId);
    this.#renewal.clear(accountId);
    this.#newLogins.delete(accountId);
    await this.#engine.dispatch(
      { type: 'account.signed_in', account: { id: accountId, email: status.email ?? account.email } },
      { id: `login:${loginId}:account.signed_in` }
    );
    await this.limits.refresh([accountId], true);
    await this.#imports.sync();
    return { ok: true, email: status.email };
  };

  #loginEnded(accountId: string, done: boolean) {
    if (done || !this.#newLogins.delete(accountId)) return;
    this.#forgetUnused(accountId).catch((error: unknown) => {
      log.warn('[Accounts] Could not clear an account that never signed in', {
        accountId,
        error: describeError(error),
      });
    });
  }

  submitLoginCode(loginId: unknown, code: unknown) {
    if (typeof loginId !== 'string' || typeof code !== 'string' || !code.trim()) {
      throw new DomainError('code_invalid', 'Paste the code the sign-in page showed.');
    }
    if (!this.logins.submitCode(loginId, code)) {
      throw new DomainError('login_stale', 'That sign-in ended. Start it again.');
    }
    return this.snapshot();
  }

  cancelLogin(loginId: unknown) {
    if (typeof loginId !== 'string') throw new DomainError('login_invalid', 'Name the sign-in to cancel.');
    const phase = this.logins.current()?.phase;
    if (phase === 'done' || phase === 'failed') this.logins.clear(loginId);
    else this.logins.cancel(loginId);
    return this.snapshot();
  }

  async importAccount(origin: unknown, email: unknown) {
    this.#assertChangeable();
    await this.#imports.importAccount(origin, email);
    return this.snapshot();
  }

  update(accountId: unknown, patchBody: unknown) {
    this.#assertChangeable();
    if (typeof accountId !== 'string')
      throw new DomainError('account_invalid', 'Name the account to change.');
    const account = this.store.find(accountId);
    const patch = parseAccountPatch(patchBody);
    if (patch.isDefault) this.store.updateDefault(account.id);
    if (patch.paused !== undefined) this.store.update(account.id, { paused: patch.paused });
    if (patch.switchAt !== undefined) this.store.update(account.id, { switchAt: patch.switchAt });
    if (patch.position !== undefined) this.store.move(account.id, patch.position);
    return this.snapshot();
  }

  async #forgetUnused(accountId: string) {
    await this.#forget(accountId);
    await this.#imports.sync();
  }

  async remove(accountId: unknown) {
    this.#assertChangeable();
    if (typeof accountId !== 'string')
      throw new DomainError('account_invalid', 'Name the account to remove.');
    this.store.find(accountId);
    await this.#forget(accountId);
    await this.#engine.dispatch(
      { type: 'account.removed', accountId },
      { id: `account.removed:${accountId}` }
    );
    await this.#imports.sync();
    return this.snapshot();
  }

  async #signOutFolder(account: StoredAccount) {
    if (!account.configDir) return;
    const claude = await this.#resolveClaude();
    const result = await this.#run([claude, 'auth', 'logout'], this.#config.userHome, {
      env: resolveAccountEnv(account.configDir),
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    if (!result.ok)
      log.warn('[Accounts] Could not sign an account’s folder out', {
        accountId: account.id,
        code: result.code,
      });
  }

  async #forget(accountId: string) {
    await this.#signOutFolder(this.store.find(accountId));
    this.store.remove(accountId);
    this.limits.remove(accountId);
    this.#signIns.delete(accountId);
    this.#rotation.clear(accountId);
    this.#renewal.clear(accountId);
    this.#newLogins.delete(accountId);
  }
}

export function createOnboardingAccounts(accounts: Accounts): AccountSource {
  return createSummaryAccountSource(() => accounts.snapshot().accounts);
}
