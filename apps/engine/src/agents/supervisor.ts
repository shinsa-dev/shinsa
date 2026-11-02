import {
  type ChatEvent,
  type ChatNotice,
  type DelegatedRun,
  DomainError,
  isDelegatedRun,
  isFoldingCompaction,
  isReadOnlyRun,
  type LoadedExtensions,
  listLiveRuns,
  type Repo,
  MINUTE_MS,
  RUN_AGENT_ROLE,
  type Run,
  type RunFailure,
  resolveAgentProvider,
  resolveContinuePrompt,
  resolveTaskProject,
  type ShinsaCommand,
} from '@shinsa/core';
import type { ServerConfig } from '../config/index.ts';
import { isSameExtensionSet, type SessionExtensionSource } from '../extensions/index.ts';
import { describeIsolatedChanges, stashEdits } from '../git/index.ts';
import { describeError, log } from '../log/index.ts';
import type { ProcessTracker } from '../resources/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { EvidenceStore } from '../store/index.ts';
import { Workspaces } from '../workspaces/index.ts';
import {
  type AccountBroker,
  type AccountLease,
  AccountLeasing,
  type RejectionHandler,
  type RejectionVerdict,
  requestVerdict,
} from './accounts.ts';
import {
  carryUndelivered,
  createActiveRun,
  isSteerable,
  resolveAttemptKey,
  stopActiveRun,
} from './active/run.ts';
import { type ActiveRun } from './active/schema.ts';
import { type ClockTimers, RunClock } from './clock.ts';
import { IdleCompaction, type IdleCompactionOptions } from './compaction.ts';
import { resolveDelegatedReply } from './delegations/delivery.ts';
import { type Delivery } from './delegations/schema.ts';
import { Deliveries } from './deliveries/service.ts';
import { SessionExtensionSets } from './extension-sets.ts';
import type { IdleReleaseOptions } from './idle.ts';
import { listSurfaceToolSpecs, type ManageAccess } from './manage/index.ts';
import {
  type AgentProvider,
  type AgentSession,
  type AgentSessionResult,
  ProviderRegistry,
  resolveCapabilities,
  resolveSessionOptions,
  type SessionStarter,
} from './providers/index.ts';
import { Questions } from './questions.ts';
import type { TaskServiceRunner } from './services.ts';
import { TaskScopes } from './supervisor/index.ts';
import { MAX_RUN_MS, QUIESCE_MS, STOP_MS, type Turn, UNGUARDED, UNREADONLY } from './supervisor/schema.ts';
import { RunSteps } from './supervisor/steps.ts';
import { isSharedCheckout, resolveWorkspace } from './supervisor/workspace.ts';
import { type ScheduleToolHandler } from './tool-calls/schema.ts';
import { ToolCalls } from './tool-calls/service.ts';
import { createShinsaTools, type ToolHandler } from './tools/index.ts';
import type { Transcripts } from './transcripts/index.ts';
import {
  isSessionCacheWarm,
  resolveRestorePlan,
  resolveTurnBrief,
  resolveTurnFold,
  resolveTurnPlan,
  resolveTurnPrompt,
} from './turns/plan.ts';
import { type TurnContext, type TurnPlan } from './turns/schema.ts';

export type NoticeListener = (runId: string, notice: ChatNotice) => void;

export interface SupervisorOptions {
  providers?: ProviderRegistry;
  startSession?: SessionStarter;
  maxRunMs?: number;
  clockTimers?: ClockTimers;
  quiesceMs?: number;
  stopMs?: number;
  onRejection?: RejectionHandler;
  onNotice?: NoticeListener;
  accounts?: AccountBroker;
  minuteMs?: number;
  schedules?: ScheduleToolHandler;
  idle?: IdleReleaseOptions;
  compaction?: IdleCompactionOptions;
  extensions?: SessionExtensionSource;
  manage?: ManageAccess;
  workspaces?: Workspaces;
  services?: TaskServiceRunner;
  trackProcess?: ProcessTracker;
}

async function settleWithin(work: Promise<unknown>, ms: number) {
  const timeout = Promise.withResolvers<'timeout'>();
  const timer = setTimeout(() => timeout.resolve('timeout'), ms);
  try {
    return await Promise.race([work.then(() => 'settled' as const), timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

function createFailure(failureClass: RunFailure['class'], message: string, code: string): RunFailure {
  return { class: failureClass, message, code, retryable: null, resetAt: null };
}

function resolveDriveFailure(error: unknown): AgentSessionResult {
  const summary = describeError(error);
  if (error instanceof DomainError && error.code === 'handoff_too_large') {
    return { outcome: 'failed', summary, failure: createFailure('context_window_full', summary, error.code) };
  }
  return { outcome: 'failed', summary };
}

export class RunSupervisor {
  readonly #engine: Engine;
  readonly #config: ServerConfig;
  readonly #transcripts: Transcripts;
  readonly #evidence: EvidenceStore;
  readonly #active = new Map<string, ActiveRun>();
  readonly #providers: ProviderRegistry;
  readonly #startSession: SessionStarter | null;
  readonly #maxRunMs: number;
  readonly #clockTimers: ClockTimers | undefined;
  readonly #quiesceMs: number;
  readonly #stopMs: number;
  readonly #onRejection: RejectionHandler | null;
  readonly #onNotice: NoticeListener | null;
  readonly #leasing: AccountLeasing;
  readonly #questions: Questions;
  readonly #tools: ToolCalls;
  readonly #deliveries: Deliveries;
  readonly #compaction: IdleCompaction;
  readonly #extensions: SessionExtensionSource | null;
  readonly #extensionSets: SessionExtensionSets;
  readonly #manages: boolean;
  readonly #trackProcess: ProcessTracker | null;
  readonly #held = new Set<string>();
  readonly #scopes = new TaskScopes();
  readonly #steps: RunSteps;
  readonly workspaces: Workspaces;
  #shuttingDown = false;
  #holding: (() => void) | null = null;

  constructor(
    engine: Engine,
    config: ServerConfig,
    transcripts: Transcripts,
    evidence: EvidenceStore,
    options: SupervisorOptions = {}
  ) {
    this.#engine = engine;
    this.#config = config;
    this.#transcripts = transcripts;
    this.#evidence = evidence;
    this.workspaces = options.workspaces ?? new Workspaces({ worktreesDir: config.worktreesDir });
    this.#providers = options.providers ?? new ProviderRegistry();
    this.#startSession = options.startSession ?? null;
    this.#maxRunMs = options.maxRunMs ?? MAX_RUN_MS;
    this.#clockTimers = options.clockTimers;
    this.#quiesceMs = options.quiesceMs ?? QUIESCE_MS;
    this.#stopMs = options.stopMs ?? STOP_MS;
    this.#onRejection = options.onRejection ?? null;
    this.#onNotice = options.onNotice ?? null;
    this.#extensions = options.extensions ?? null;
    this.#extensionSets = new SessionExtensionSets(transcripts, () => this.#engine.state);
    this.#leasing = new AccountLeasing(options.accounts ?? null, () => this.#engine.state, transcripts);
    this.#steps = new RunSteps({
      engine,
      config,
      transcripts,
      providers: this.#providers,
      leasing: this.#leasing,
      recordEntry: (runId, entry) => this.#recordEntry(runId, entry),
    });
    this.#questions = new Questions({
      engine,
      transcripts,
      active: this.#active,
      execute: (runId, prompt) => this.execute(runId, prompt),
      idle: options.idle,
    });
    this.#tools = new ToolCalls({
      engine,
      evidence,
      transcripts,
      providers: this.#providers,
      questions: this.#questions,
      schedules: options.schedules ?? null,
      minuteMs: options.minuteMs ?? MINUTE_MS,
      manage: options.manage ?? null,
      workspaces: this.workspaces,
      services: options.services ?? null,
      listServerNames: (run) => this.#listServerNames(run),
    });
    this.#manages = options.manage !== undefined;
    this.#trackProcess = options.trackProcess ?? null;
    this.#deliveries = new Deliveries({
      engine,
      transcripts,
      active: this.#active,
      execute: (runId, prompt, delivery) => this.execute(runId, prompt, delivery),
    });
    this.#compaction = new IdleCompaction(
      () => this.#engine.state,
      (runId, sessionId, signal) => this.#compact(runId, sessionId, signal),
      options.compaction
    );
  }

  async execute(runId: string, override: string | null = null, delivery: Delivery | null = null) {
    const state = this.#engine.state;
    const run = state.runs[runId];
    if (!run || run.endedAt !== null || this.#active.has(runId)) return;
    if (this.#shuttingDown) {
      await this.#markInterrupted(runId, null);
      return;
    }
    if (this.#holding && override === null && delivery === null) {
      if (this.#held.has(runId)) return;
      this.#held.add(runId);
      this.#holding();
      return;
    }
    const task = state.tasks[run.taskId];
    const workspace = task ? resolveWorkspace(state, this.#config, run, task) : null;
    if (!task || !workspace) {
      await this.#end(runId, { outcome: 'failed', summary: 'The task has no worktree to run in.' }, null);
      return;
    }
    const delegated = isDelegatedRun(run);
    const provider = this.#providers.resolve(
      delegated ? run.provider : resolveAgentProvider(state.settings, RUN_AGENT_ROLE[run.role])
    );
    const released = Promise.withResolvers<void>();
    const active = createActiveRun(task.id, released.promise, {
      steerable: resolveCapabilities(provider).turns.steering,
      delegated,
      delivery,
    });
    this.#active.set(runId, active);
    let result: AgentSessionResult;
    try {
      if (!delegated) await this.#compaction.settle(task.id);
      if (!delegated) await this.quiesce(task.id, runId);
      const current = this.#engine.state.runs[runId];
      if (!current || current.endedAt !== null || this.#shuttingDown) return;
      const prompt = override ?? run.prompt ?? '';
      const brief = resolveTurnBrief(this.#engine.state, current, override);
      const { cwd, defaultBranch } = await this.#steps.prepareWorkspace(workspace);
      const stepPrompt = override === null;
      const turn = { run: current, cwd, defaultBranch, prompt, brief, stepPrompt, provider, active };
      result = await this.#prepareAndDrive(turn, workspace.repo);
      if (isReadOnlyRun(run) && !isSharedCheckout(run, workspace)) await this.#discardEdits(cwd, run.role);
      if (isDelegatedRun(current)) result = await this.#resolveDelegatedResult(current, cwd, result);
    } finally {
      this.#active.delete(runId);
      this.#questions.forget(runId);
      released.resolve();
    }
    await this.#settle(runId, active, result);
  }

  async #settle(runId: string, active: ActiveRun, result: AgentSessionResult) {
    if (this.#shuttingDown) {
      this.#reportUndelivered(runId, active, result);
      return;
    }
    const undelivered = await this.#deliveries.release(runId, active, [
      ...active.unsteered,
      ...(result.undelivered ?? []),
    ]);
    if (active.released) return;
    await this.#end(runId, result, active.attemptId);
    this.#compaction.record(runId, result.context ?? null);
    if (!active.delegated) this.#compaction.schedule(active.taskId);
    await this.#redeliver(active.taskId, resolveAttemptKey(runId, active.attemptId), [
      ...active.unsent,
      ...active.queued,
      ...undelivered,
    ]);
  }

  async #prepareAndDrive(turn: Turn, repo: Repo | null): Promise<AgentSessionResult> {
    const { run, provider } = turn;
    if (isReadOnlyRun(run) && !resolveCapabilities(provider).planning.readOnly) {
      return {
        outcome: 'failed',
        summary: UNREADONLY,
        failure: createFailure('setup_failed', UNREADONLY, 'read_only'),
      };
    }
    if (!isDelegatedRun(run)) return this.#drive(turn);
    const isolation = await this.#steps.prepareIsolation(run, repo);
    if (isolation !== null) {
      return {
        outcome: 'failed',
        summary: isolation,
        failure: createFailure('setup_failed', isolation, 'isolation'),
      };
    }
    return this.#drive(turn);
  }

  async #resolveDelegatedResult(run: DelegatedRun, cwd: string, result: AgentSessionResult) {
    if (result.outcome !== 'completed') return result;
    const reply = resolveDelegatedReply(this.#transcripts.listEntries(run.id)) ?? result.summary;
    if (run.delegation.isolation !== 'worktree') return { ...result, summary: reply };
    const changed = await describeIsolatedChanges(cwd);
    if (!changed) return { ...result, summary: reply };
    const files = `${changed} ${changed === 1 ? 'file' : 'files'}`;
    const note = `Its changes are not committed: ${files} in its own checkout at \`${cwd}\`. Bring over what you need, for example with \`git -C ${cwd} diff | git apply\`.`;
    return { ...result, summary: reply ? `${reply}\n\n${note}` : note };
  }

  #context(turn: Turn): TurnContext {
    return {
      state: this.#engine.state,
      run: turn.run,
      provider: turn.provider,
      cwd: turn.cwd,
      transcripts: this.#transcripts,
      labelOf: (id) => this.#providers.select(id)?.label ?? id,
      recordLost: async (sessionId) => {
        await this.#recordSessionLost(turn.run.id, sessionId);
      },
    };
  }

  async #drive(turn: Turn): Promise<AgentSessionResult> {
    const { run, active, provider } = turn;
    if (!resolveCapabilities(provider).approvals) {
      return {
        outcome: 'failed',
        summary: UNGUARDED,
        failure: createFailure('setup_failed', UNGUARDED, 'unguarded'),
      };
    }
    let timedOut = false;
    active.clock = new RunClock(
      this.#maxRunMs,
      () => {
        timedOut = true;
        if (active.session) this.#cancelSession(run.id, active);
        active.wake?.();
      },
      this.#clockTimers
    );
    try {
      this.#transcripts.record(run.id, { type: 'status', status: 'started', outcome: null });
      active.clock.start();
      let plan = await resolveTurnPlan(this.#context(turn));
      let restored = false;
      for (;;) {
        const { attemptId, result } = await this.#attempt(turn, plan);
        if (timedOut)
          return { outcome: 'failed', summary: 'It ran past its time limit without handing over.' };
        if (result.failure?.class === 'session_lost' && plan.resume !== null && !restored) {
          restored = true;
          carryUndelivered(active, result.undelivered);
          plan = await this.#restoreLost(turn, plan, plan.resume);
          continue;
        }
        if (await this.#steps.isOverloadRetry(active, result, this.#shuttingDown)) {
          await this.#steps.waitForOverload(turn, result.failure?.message ?? '');
          if (timedOut)
            return { outcome: 'failed', summary: 'It ran past its time limit without handing over.' };
          if (active.stopping)
            return { outcome: 'cancelled', summary: null, undelivered: result.undelivered };
          carryUndelivered(active, result.undelivered);
          continue;
        }
        const verdict = await this.#review(turn, attemptId, result);
        if (!verdict.retry) return verdict.failure ? { ...result, failure: verdict.failure } : result;
        if (verdict.renewed) this.#retryRenewed(active, verdict.renewed);
        carryUndelivered(active, result.undelivered);
      }
    } catch (error) {
      return resolveDriveFailure(error);
    } finally {
      active.clock.stop();
    }
  }

  async #restoreLost(turn: Turn, plan: TurnPlan, sessionId: string) {
    if (!plan.fork) await this.#recordSessionLost(turn.run.id, sessionId);
    return resolveRestorePlan(this.#context(turn), plan, sessionId);
  }

  #recordSessionLost(runId: string, sessionId: string) {
    return this.#engine.dispatch(
      { type: 'run.record_lost_session', runId, sessionId },
      { id: `run.record_lost_session:${runId}:${sessionId}` }
    );
  }

  #review(
    turn: Turn,
    attemptId: string,
    result: AgentSessionResult
  ): Promise<RejectionVerdict> | RejectionVerdict {
    const { active, run } = turn;
    if (!this.#onRejection || result.outcome !== 'failed' || !result.failure || active.stopping) {
      return { retry: false };
    }
    const accountId = active.lease?.id ?? null;
    if (accountId) active.rejected.push(accountId);
    if (accountId && result.failure.class === 'usage_limit') this.#markLeaseSpent(run.id, accountId);
    return requestVerdict(this.#onRejection, {
      runId: run.id,
      taskId: run.taskId,
      provider: turn.provider.id,
      attemptId,
      accountId,
      tried: [...active.rejected],
      renewed: [...active.renewed],
      failure: result.failure,
    });
  }

  #retryRenewed(active: ActiveRun, accountId: string) {
    active.renewed.push(accountId);
    active.rejected = active.rejected.filter((id) => id !== accountId);
    active.renewing = { id: accountId, email: active.lease?.email ?? null };
  }

  #markLeaseSpent(except: string, accountId: string) {
    for (const [runId, active] of this.#active) {
      if (runId === except || active.lease?.id !== accountId || active.leaseSpent) continue;
      active.leaseSpent = true;
      log.info('[Runs] Another run hit the usage limit of this run’s account; its next turn moves', {
        runId,
        accountId,
      });
      void this.#questions.releaseWaiting(runId);
    }
  }

  async #resolveExtensions(run: Run, pin: LoadedExtensions | null) {
    if (!this.#extensions) return null;
    const state = this.#engine.state;
    const task = state.tasks[run.taskId];
    const repo = task?.repoId ? state.repos[task.repoId] : undefined;
    try {
      return await this.#extensions.resolveSession(
        { repoPath: repo?.path ?? null, project: task ? resolveTaskProject(state, task) : null },
        pin
      );
    } catch (error) {
      log.warn('[Runs] Could not resolve the MCP servers and skills for a run', {
        runId: run.id,
        error: describeError(error),
      });
      return null;
    }
  }

  async #listServerNames(run: Run) {
    const extensions = await this.#resolveExtensions(run, null);
    if (!extensions) return [];
    const names = [...extensions.servers, ...extensions.deferred].flatMap((server) => [
      server.name,
      server.claudeName,
    ]);
    const keys = names.map((name) => name.toLowerCase());
    return names.filter((name, index) => keys.indexOf(name.toLowerCase()) === index);
  }

  async #attempt(turn: Turn, plan: TurnPlan) {
    const { run, active, provider } = turn;
    const firstAttempt = (this.#engine.state.runs[run.id]?.attempts ?? []).length === 0;
    const { attemptId, account } = await this.#steps.recordAttempt(turn, plan);
    const weeklyBefore = this.#leasing.readWeeklyReading(run.id, active.lease, provider.id, false);
    const pin = plan.resume ? this.#extensionSets.select(plan.resume) : null;
    const extensions = await this.#resolveExtensions(run, pin);
    const loader = extensions ? (this.#extensions?.createLoader?.(extensions) ?? null) : null;
    const handleTool: ToolHandler = (name, input, signal, requestId) => {
      if (loader?.isLoaderTool(name)) return loader.handle(name, input);
      return this.#tools.handle(name, { runId: run.id, attemptId, input, signal, requestId });
    };
    const startSession = this.#startSession ?? provider.startSession;
    let sessionId = plan.fork ? null : plan.resume;
    const options = await this.#resolveSpeed(run, provider, active.lease, true);
    const releases: (() => void)[] = [];
    const fold = resolveTurnFold({
      run,
      plan,
      stepPrompt: turn.stepPrompt,
      firstAttempt,
      folds: resolveCapabilities(provider).folds && isFoldingCompaction(options.compaction ?? 'off'),
    });
    const session = startSession({
      role: run.role,
      readOnly: isReadOnlyRun(run),
      cwd: turn.cwd,
      prompt: resolveTurnPrompt(this.#context(turn), plan, turn.prompt, turn.brief, fold),
      model: await this.#steps.resolveModel(turn),
      resume: plan.resume,
      fork: plan.fork,
      defaultBranch: turn.defaultBranch,
      pluginDir: this.#config.pluginDir,
      tools: createShinsaTools(run.role, handleTool, run.delegation?.depth ?? 0, [
        ...(this.#manages && !isDelegatedRun(run) ? listSurfaceToolSpecs() : []),
        ...(loader?.listSpecs() ?? []),
      ]),
      ...(extensions
        ? { extensions, announceExtensions: !pin || !isSameExtensionSet(pin, extensions.loaded) }
        : {}),
      ...options,
      ...(fold && plan.resume
        ? { fold, cacheWarm: isSessionCacheWarm(this.#context(turn), plan.resume, Date.now()) }
        : {}),
      ...(active.lease ? { account: { id: active.lease.id, configDir: active.lease.configDir } } : {}),
      usageBaseline: this.#readSessionUsage,
      onSession: (linked) => {
        sessionId = linked;
        if (extensions) this.#extensionSets.record(linked, extensions.loaded);
        this.#linkSession(run, attemptId, provider.id, linked);
        this.#deliveries.confirmWake(run.id, active);
      },
      onEntry: (entry) => this.#recordEntry(run.id, entry),
      onActivity: () => this.#questions.touch(run.id),
      onProcess: (pid) => {
        if (this.#trackProcess) releases.push(this.#trackProcess(run.taskId, 'agent', pid));
      },
      storeImage: (data, mediaType) => this.#storeImage(data, mediaType),
    });
    const scoped = this.#scopes.acquire(
      { taskId: run.taskId, runId: run.id, parentRunId: run.delegation?.parentRunId ?? null },
      session
    );
    active.session = session;
    loader?.attach(session);
    try {
      await this.#steerWaiting(run.id, active, session);
      const result = await scoped.done;
      await this.#steps.meterAttempt(turn, attemptId, sessionId, result, weeklyBefore);
      if (!account || !result.failure) return { attemptId, result };
      return { attemptId, result: { ...result, failure: { ...result.failure, account } } };
    } finally {
      active.session = null;
      await scoped.close();
      for (const release of releases) release();
      await loader?.close();
    }
  }

  async #resolveSpeed(run: Run, provider: AgentProvider, lease: AccountLease | null, notify: boolean) {
    const options = resolveSessionOptions(this.#engine.state.settings, provider, RUN_AGENT_ROLE[run.role]);
    if (!options.fastMode) return options;
    const availability = await this.#leasing.readFastMode(lease, provider.id);
    if (availability === 'available') return options;
    if (notify) {
      const reason = availability === 'needs_credits' ? 'needs_credits' : 'credits_unknown';
      this.#recordEntry(run.id, {
        type: 'notice',
        notice: { kind: 'fast_mode', status: 'unavailable', reason },
      });
    }
    return { ...options, fastMode: false };
  }

  async #steerWaiting(runId: string, active: ActiveRun, session: AgentSession) {
    for (const text of active.queued.splice(0)) {
      if (!session.steer(text)) active.unsent.push(text);
    }
    for (const text of active.resteered.splice(0)) {
      if (!session.steer(text, 'shinsa')) active.unsteered.push(text);
    }
    for (const delivery of active.held.splice(0)) await this.#deliveries.steer(runId, active, delivery);
  }

  #recordEntry(runId: string, entry: ChatEvent) {
    this.#transcripts.record(runId, entry);
    if (entry.type === 'notice') this.#onNotice?.(runId, entry.notice);
  }

  #linkSession(run: Run, attemptId: string, provider: string, sessionId: string) {
    if (sessionId === run.sessionId && provider === (run.sessionProvider ?? run.provider)) return;
    this.#engine
      .dispatch(
        { type: 'run.link', runId: run.id, sessionId, attemptId, provider },
        { id: `run.link:${attemptId}:${sessionId}` }
      )
      .catch((error: unknown) => {
        log.warn('[Runs] Could not link session', { runId: run.id, error: describeError(error) });
      });
  }

  #cancelSession(runId: string, active: ActiveRun) {
    stopActiveRun(active);
    active.session?.cancel().catch((error: unknown) => {
      log.warn('[Runs] Could not stop a session', { runId, error: describeError(error) });
    });
  }

  async #discardEdits(path: string, role: string) {
    try {
      if (await stashEdits(path, `shinsa: edits by the ${role}`)) {
        log.warn('[Runs] A read-only agent changed files; set them aside', { role, path });
      }
    } catch (error) {
      log.warn('[Runs] Could not set aside edits by a read-only agent', {
        role,
        path,
        error: describeError(error),
      });
    }
  }

  async #end(runId: string, result: AgentSessionResult, attemptId: string | null) {
    this.#transcripts.record(runId, { type: 'status', status: 'ended', outcome: result.outcome });
    const command: ShinsaCommand = {
      type: 'run.end',
      runId,
      outcome: result.outcome,
      summary: result.summary,
      ...(attemptId ? { attemptId } : {}),
      ...(result.failure ? { failure: result.failure } : {}),
      ...(result.context?.cacheExpiresAt ? { cacheExpiresAt: result.context.cacheExpiresAt } : {}),
    };
    await this.#engine.dispatch(command, { id: `run.end:${attemptId ?? runId}` });
  }

  async #redeliver(taskId: string, attemptKey: string, texts: string[]) {
    for (const [index, text] of texts.entries()) {
      await this.#engine.dispatch(
        { type: 'message.deliver', taskId, text },
        { id: `message.deliver:${attemptKey}:${index}` }
      );
    }
  }

  #reportUndelivered(runId: string, active: ActiveRun, result: AgentSessionResult) {
    const count =
      active.queued.length +
      active.unsent.length +
      active.resteered.length +
      active.unsteered.length +
      (result.undelivered?.length ?? 0);
    if (count === 0) return;
    log.warn('[Runs] Messages that never reached the agent before Shinsa stopped', { runId, count });
  }

  #listEarlier(taskId: string, except: string | undefined) {
    const earlier: [string, ActiveRun][] = [];
    for (const [id, active] of this.#active) {
      if (id === except) break;
      if (active.taskId === taskId && !(except && active.delegated)) earlier.push([id, active]);
    }
    return earlier;
  }

  async quiesce(taskId: string, except?: string) {
    const earlier = this.#listEarlier(taskId, except);
    if (earlier.length === 0) return;
    const settled = Promise.allSettled(earlier.map(([, active]) => active.done));
    if ((await settleWithin(settled, this.#quiesceMs)) === 'settled') return;
    await this.#stopWithin(earlier, settled);
  }

  async #stopWithin(runs: [string, ActiveRun][], settled: Promise<unknown>) {
    const cancelled = Promise.allSettled(runs.map(([, active]) => active.session?.cancel()));
    if ((await settleWithin(Promise.all([cancelled, settled]), this.#stopMs)) === 'settled') return;
    for (const [runId, active] of runs) {
      if (this.#active.get(runId) !== active) continue;
      log.warn('[Runs] A run did not stop in time, so Shinsa stopped waiting for it', {
        runId,
        taskId: active.taskId,
      });
      this.#active.delete(runId);
    }
  }

  async #markInterrupted(runId: string, attemptId: string | null) {
    const continuations = this.#engine.state.runs[runId]?.continuations?.length ?? 0;
    const attempt = attemptId ?? `${runId}:0:${continuations}`;
    try {
      await this.#engine.dispatch(
        { type: 'run.interrupt', runId, attemptId },
        { id: `run.interrupt:${attempt}` }
      );
    } catch (error) {
      log.warn('[Runs] Could not mark a run to resume after the restart', {
        runId,
        error: describeError(error),
      });
    }
  }

  async steer(runId: string, text: string, cause?: string, from?: 'shinsa') {
    const run = this.#engine.state.runs[runId];
    if (!run) return;
    const active = this.#active.get(runId);
    if (run.endedAt === null && active && isSteerable(active)) {
      if (!active.session) {
        (from ? active.resteered : active.queued).push(text);
        return;
      }
      if (active.session.steer(text, from)) return;
    }
    await this.#engine.dispatch(
      { type: 'message.deliver', taskId: run.taskId, text },
      cause === undefined ? {} : { id: `${cause}:message.deliver` }
    );
  }

  async cancel(runId: string) {
    const active = this.#active.get(runId);
    if (!active) return;
    stopActiveRun(active);
    await settleWithin(this.#scopes.cancel(runId), this.#stopMs);
  }

  holdNewRuns(onHeld: () => void) {
    this.#holding = onHeld;
  }

  releaseHeldRuns() {
    this.#holding = null;
    const held = [...this.#held];
    this.#held.clear();
    for (const runId of held) {
      this.execute(runId).catch((error: unknown) => {
        log.error('[Runs] Could not start a run held for the restart', {
          runId,
          error: describeError(error),
        });
      });
    }
  }

  isHeld(runId: string) {
    return this.#held.has(runId);
  }

  async interruptForShutdown() {
    this.#shuttingDown = true;
    const compacting = this.#compaction.stop();
    await this.#interruptHeld();
    const live = [...this.#active.entries()];
    for (const [runId, active] of live) await this.#markInterrupted(runId, active.attemptId);
    for (const [, active] of live) stopActiveRun(active);
    await this.#stopWithin(live, Promise.allSettled([compacting, ...live.map(([, active]) => active.done)]));
    await settleWithin(this.#scopes.closeAll(), this.#stopMs);
  }

  async #interruptHeld() {
    for (const runId of this.#held) await this.#markInterrupted(runId, null);
    this.#held.clear();
  }

  resolveQuestion(gateId: string) {
    return this.#questions.resolve(gateId);
  }

  replyToDelegate(runId: string, questionId: string) {
    return this.#questions.replyToDelegate(runId, questionId);
  }

  deliver(runId: string, generation: number) {
    return this.#deliveries.deliver(runId, generation);
  }

  wake(runId: string, generation: number) {
    return this.#deliveries.wake(runId, generation);
  }

  async recover() {
    const boot = `boot:${this.#engine.state.seq}`;
    const runs = listLiveRuns(this.#engine.state)
      .filter((run) => run.status !== 'queued')
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const run of runs) {
      let continued = false;
      try {
        const events = await this.#engine.dispatch(
          { type: 'run.continue', runId: run.id },
          { id: `${boot}:run.continue:${run.id}` }
        );
        continued = events.some((event) => event.type === 'run.continued');
      } catch (error) {
        log.error('[Runs] Could not decide whether to resume a run', {
          runId: run.id,
          error: describeError(error),
        });
      }
      if (!continued) continue;
      const started = (run.attempts?.length ?? 0) > 0 && run.sessionId !== null;
      this.execute(run.id, started ? resolveContinuePrompt() : null).catch((error: unknown) => {
        log.error('[Runs] Resume failed', { runId: run.id, error: describeError(error) });
      });
    }
    await this.#engine.dispatch({ type: 'runs.dispatch' }, { id: `${boot}:runs.dispatch` });
    await this.#engine.dispatch({ type: 'delegations.recover' }, { id: `${boot}:delegations.recover` });
  }

  async #compact(runId: string, sessionId: string, signal: AbortSignal) {
    const state = this.#engine.state;
    const run = state.runs[runId];
    const task = run ? state.tasks[run.taskId] : undefined;
    const provider = run ? this.#providers.select(run.sessionProvider ?? run.provider) : null;
    const workspace = run && task ? resolveWorkspace(state, this.#config, run, task) : null;
    if (!run || !workspace || !provider?.compactSession || !resolveCapabilities(provider).compaction) return;
    const id = `idle-compact:${runId}:${sessionId}`;
    const events = await this.#engine.dispatch({ type: 'run.compact', runId, sessionId }, { id });
    if (!events.some((event) => event.type === 'run.compacted')) return;
    const lease = await this.#leasing.leaseSession(run);
    if (signal.aborted) return;
    log.info('[Runs] Compacting an idle session before its prompt cache expires', { runId, sessionId });
    const session = provider.compactSession({
      role: run.role,
      readOnly: isReadOnlyRun(run),
      cwd: (await this.#steps.prepareWorkspace(workspace)).cwd,
      model: run.attempts?.at(-1)?.model ?? run.model,
      resume: sessionId,
      defaultBranch: workspace.defaultBranch,
      pluginDir: this.#config.pluginDir,
      tools: createShinsaTools(run.role, () => Promise.reject(new Error('This turn only compacts. End it.'))),
      ...(await this.#resolveSpeed(run, provider, lease, false)),
      ...(lease ? { account: { id: lease.id, configDir: lease.configDir } } : {}),
      usageBaseline: this.#readSessionUsage,
      onSession: () => undefined,
      onEntry: (entry) => {
        if (entry.type === 'notice' && entry.notice.kind === 'compaction')
          this.#transcripts.record(runId, entry);
      },
    });
    const cancel = () => this.#cancelCompaction(runId, session);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const result = await session.done;
    if (result.usage) await this.#steps.meter(runId, sessionId, result.usage, `${id}:run.meter`);
  }

  #readSessionUsage = (sessionId: string) => this.#engine.state.sessionUsage[sessionId] ?? null;

  #cancelCompaction(runId: string, session: AgentSession) {
    session.cancel().catch((error: unknown) => {
      log.warn('[Runs] Could not stop a compaction', { runId, error: describeError(error) });
    });
  }

  #storeImage(data: string, mediaType: string) {
    try {
      return this.#evidence.writeImage(data, mediaType);
    } catch (error) {
      log.warn('[Runs] Could not keep a tool image', { error: describeError(error) });
      return null;
    }
  }
}
