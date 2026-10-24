import {
  type ChatEvent,
  type ChatNotice,
  type DelegatedRun,
  DomainError,
  isDelegatedRun,
  isReadOnlyRole,
  listLiveRuns,
  type Repo,
  RUN_AGENT_ROLE,
  type Run,
  type RunAccount,
  type RunFailure,
  type RunRole,
  type RunUsage,
  resolveAgentModel,
  resolveAgentProvider,
  resolveContinuePrompt,
  resolveHandoffPrompt,
  resolveTaskProject,
  resolveWeeklyUsed,
  type ShinsaCommand,
  type Task,
} from '@shinsa/core';
import type { ServerConfig } from '../config/index.ts';
import type { SessionExtensionSource } from '../extensions/index.ts';
import {
  createIsolatedWorktree,
  describeIsolatedChanges,
  resolveIsolatedPath,
  stashEdits,
} from '../git/index.ts';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { EvidenceStore } from '../store/index.ts';
import {
  type AccountBroker,
  type AccountLease,
  AccountLeasing,
  type RejectionHandler,
  type RejectionVerdict,
  requestVerdict,
} from './accounts.ts';
import {
  type ActiveRun,
  carryUndelivered,
  createActiveRun,
  isSteerable,
  resolveAttemptKey,
} from './active.ts';
import { type ClockTimers, MINUTE_MS, RunClock } from './clock.ts';
import { IdleCompaction, type IdleCompactionOptions } from './compaction.ts';
import { type Delivery, resolveDelegatedReply } from './delegations.ts';
import { Deliveries } from './deliveries.ts';
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
import { type ScheduleToolHandler, ToolCalls } from './tool-calls.ts';
import { createShinsaTools, type ToolHandler } from './tools/index.ts';
import type { Transcripts } from './transcripts/index.ts';
import { resolveHandoffPlan, resolveTurnPlan, type TurnContext, type TurnPlan } from './turns.ts';

export type NoticeListener = (runId: string, notice: ChatNotice) => void;

export interface SupervisorOptions {
  providers?: ProviderRegistry;
  startSession?: SessionStarter;
  maxRunMs?: number;
  clockTimers?: ClockTimers;
  quiesceMs?: number;
  onRejection?: RejectionHandler;
  onNotice?: NoticeListener;
  accounts?: AccountBroker;
  minuteMs?: number;
  schedules?: ScheduleToolHandler;
  idle?: IdleReleaseOptions;
  compaction?: IdleCompactionOptions;
  extensions?: SessionExtensionSource;
  manage?: ManageAccess;
}

interface Turn {
  run: Run;
  cwd: string;
  defaultBranch: string;
  prompt: string;
  provider: AgentProvider;
  active: ActiveRun;
}

const MAX_RUN_MS = 2 * 60 * 60 * 1000;

const QUIESCE_MS = 60_000;

const UNGUARDED = 'This agent provider cannot stop the commands Shinsa forbids, so Shinsa will not run it.';

const UNREADONLY =
  'This agent provider cannot keep a read-only agent from changing files, so Shinsa will not run a read-only task on it.';

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

function resolveRoleCwd(role: RunRole, task: Task, repo: Repo) {
  if (role === 'answerer') return repo.path;
  if (role === 'researcher') return task.worktreePath ?? repo.path;
  return task.worktreePath;
}

function isSharedCheckout(run: Run, cwd: string, repo: Repo) {
  return cwd === repo.path || run.delegation?.isolation === 'shared';
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
  readonly #onRejection: RejectionHandler | null;
  readonly #onNotice: NoticeListener | null;
  readonly #leasing: AccountLeasing;
  readonly #questions: Questions;
  readonly #tools: ToolCalls;
  readonly #deliveries: Deliveries;
  readonly #compaction: IdleCompaction;
  readonly #extensions: SessionExtensionSource | null;
  readonly #manages: boolean;
  #shuttingDown = false;

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
    this.#providers = options.providers ?? new ProviderRegistry();
    this.#startSession = options.startSession ?? null;
    this.#maxRunMs = options.maxRunMs ?? MAX_RUN_MS;
    this.#clockTimers = options.clockTimers;
    this.#quiesceMs = options.quiesceMs ?? QUIESCE_MS;
    this.#onRejection = options.onRejection ?? null;
    this.#onNotice = options.onNotice ?? null;
    this.#extensions = options.extensions ?? null;
    this.#leasing = new AccountLeasing(options.accounts ?? null, () => this.#engine.state, transcripts);
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
    });
    this.#manages = options.manage !== undefined;
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
    if (this.#shuttingDown || !run || run.endedAt !== null || this.#active.has(runId)) return;
    const task = state.tasks[run.taskId];
    const repo = task?.repoId ? state.repos[task.repoId] : undefined;
    const cwd = task && repo ? this.#resolveCwd(run, task, repo) : null;
    if (!task || !cwd || !repo) {
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
      const turn = { run: current, cwd, defaultBranch: repo.defaultBranch, prompt, provider, active };
      result = await this.#prepareAndDrive(turn, repo);
      if (isReadOnlyRole(run.role) && !isSharedCheckout(run, cwd, repo))
        await this.#discardEdits(cwd, run.role);
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

  #resolveCwd(run: Run, task: Task, repo: Repo) {
    if (!isDelegatedRun(run)) return resolveRoleCwd(run.role, task, repo);
    if (run.delegation.isolation === 'worktree') {
      return resolveIsolatedPath(this.#config.worktreesDir, task.id, run.id);
    }
    return task.worktreePath ?? repo.path;
  }

  async #prepareAndDrive(turn: Turn, repo: Repo): Promise<AgentSessionResult> {
    const { run, provider } = turn;
    if (isReadOnlyRole(run.role) && !resolveCapabilities(provider).planning.readOnly) {
      return {
        outcome: 'failed',
        summary: UNREADONLY,
        failure: createFailure('setup_failed', UNREADONLY, 'read_only'),
      };
    }
    if (!isDelegatedRun(run)) return this.#drive(turn);
    const baseCommit = run.delegation.baseCommit;
    if (run.delegation.isolation === 'worktree' && baseCommit) {
      try {
        await createIsolatedWorktree(repo, this.#config.worktreesDir, run.taskId, run.id, baseCommit);
      } catch (error) {
        const summary = `Shinsa could not set up its own checkout: ${describeError(error)}`;
        return { outcome: 'failed', summary, failure: createFailure('setup_failed', summary, 'isolation') };
      }
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
          await this.#recordSessionLost(run.id, plan.resume);
          plan = resolveHandoffPlan(this.#context(turn), 'session_restore', plan.resume, provider.id);
          continue;
        }
        const verdict = await this.#review(turn, attemptId, result);
        if (!verdict.retry) return verdict.failure ? { ...result, failure: verdict.failure } : result;
        carryUndelivered(active, result.undelivered);
      }
    } catch (error) {
      return resolveDriveFailure(error);
    } finally {
      active.clock.stop();
    }
  }

  #recordSessionLost(runId: string, sessionId: string) {
    return this.#engine.dispatch(
      { type: 'run.session_lost', runId, sessionId },
      { id: `run.session_lost:${runId}:${sessionId}` }
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
      failure: result.failure,
    });
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

  #leaseAttempt(turn: Turn) {
    if (!resolveCapabilities(turn.provider).accounts) return null;
    return this.#leasing.leaseAttempt(turn.run, [...turn.active.rejected]);
  }

  #resolveModel({ run, provider }: Turn) {
    if (provider.id === run.provider) return run.model;
    return resolveAgentModel(this.#engine.state.settings, RUN_AGENT_ROLE[run.role], provider.id);
  }

  async #recordAttempt(turn: Turn, plan: TurnPlan) {
    const { run, active, provider } = turn;
    const recorded = this.#engine.state.runs[run.id]?.attempts?.length ?? 0;
    active.attempts = Math.max(recorded, active.attempts) + 1;
    const attemptId = `${run.id}:${active.attempts}`;
    active.attemptId = attemptId;
    active.leaseSpent = false;
    active.lease = await this.#leaseAttempt(turn);
    const account: RunAccount | null = active.lease
      ? { id: active.lease.id, email: active.lease.email }
      : null;
    await this.#engine.dispatch(
      {
        type: 'run.attempt',
        runId: run.id,
        attemptId,
        provider: provider.id,
        model: this.#resolveModel(turn),
        resumed: plan.resume !== null,
        handoff: plan.record,
        ...(account ? { account } : {}),
      },
      { id: `run.attempt:${attemptId}` }
    );
    if (plan.record) {
      const { reason, fromProvider, totalEntries, includedEntries } = plan.record;
      this.#transcripts.record(run.id, {
        type: 'notice',
        notice: {
          kind: 'handoff',
          reason,
          fromProvider: this.#providers.select(fromProvider)?.label ?? fromProvider,
          toProvider: provider.label,
          totalEntries,
          includedEntries,
        },
      });
    }
    return { attemptId, account };
  }

  async #resolveExtensions(run: Run) {
    if (!this.#extensions) return null;
    const state = this.#engine.state;
    const task = state.tasks[run.taskId];
    const repo = task?.repoId ? state.repos[task.repoId] : undefined;
    try {
      return await this.#extensions.resolveSession({
        repoPath: repo?.path ?? null,
        project: task ? resolveTaskProject(state, task) : null,
      });
    } catch (error) {
      log.warn('[Runs] Could not resolve the MCP servers and skills for a run', {
        runId: run.id,
        error: describeError(error),
      });
      return null;
    }
  }

  async #attempt(turn: Turn, plan: TurnPlan) {
    const { run, active, provider } = turn;
    const { attemptId, account } = await this.#recordAttempt(turn, plan);
    const weeklyBefore = this.#leasing.readWeeklyPercent(run.id, active.lease, provider.id, false);
    const extensions = await this.#resolveExtensions(run);
    const loader = extensions ? (this.#extensions?.createLoader?.(extensions) ?? null) : null;
    const handleTool: ToolHandler = (name, input, signal, requestId) => {
      if (loader?.isLoaderTool(name)) return loader.handle(name, input);
      return this.#tools.handle(name, { runId: run.id, attemptId, input, signal, requestId });
    };
    const startSession = this.#startSession ?? provider.startSession;
    let sessionId = plan.resume;
    const options = await this.#resolveSpeed(run, provider, active.lease, true);
    const session = startSession({
      role: run.role,
      cwd: turn.cwd,
      prompt: plan.handoff ? resolveHandoffPrompt(plan.handoff.text, turn.prompt) : turn.prompt,
      model: this.#resolveModel(turn),
      resume: plan.resume,
      defaultBranch: turn.defaultBranch,
      pluginDir: this.#config.pluginDir,
      tools: createShinsaTools(run.role, handleTool, run.delegation?.depth ?? 0, [
        ...(this.#manages && !isDelegatedRun(run) ? listSurfaceToolSpecs() : []),
        ...(loader?.listSpecs() ?? []),
      ]),
      ...(extensions ? { extensions } : {}),
      ...options,
      ...(active.lease ? { account: { id: active.lease.id, configDir: active.lease.configDir } } : {}),
      usageBaseline: this.#readSessionUsage,
      onSession: (linked) => {
        sessionId = linked;
        this.#linkSession(run, attemptId, provider.id, linked);
        this.#deliveries.confirmWake(run.id, active);
      },
      onEntry: (entry) => this.#recordEntry(run.id, entry),
      onActivity: () => this.#questions.touch(run.id),
      storeImage: (data, mediaType) => this.#storeImage(data, mediaType),
    });
    active.session = session;
    loader?.attach(session);
    await this.#steerWaiting(run.id, active, session);
    try {
      const result = await session.done;
      await this.#meterAttempt(turn, attemptId, sessionId, result, weeklyBefore);
      if (!account || !result.failure) return { attemptId, result };
      return { attemptId, result: { ...result, failure: { ...result.failure, account } } };
    } finally {
      active.session = null;
      await loader?.close();
    }
  }

  async #meterAttempt(
    { run, active, provider }: Turn,
    attemptId: string,
    sessionId: string | null,
    result: AgentSessionResult,
    weeklyBefore: Promise<number | null>
  ) {
    if (result.usage) {
      const weekly = resolveWeeklyUsed(
        await weeklyBefore,
        await this.#leasing.readWeeklyPercent(run.id, active.lease, provider.id, true)
      );
      await this.#meter(run.id, sessionId, result.usage, `run.meter:${attemptId}`, weekly);
    }
    for (const subagent of result.subagentUsage ?? []) {
      const id = `run.meter:${attemptId}:${subagent.sessionId}`;
      await this.#meter(run.id, subagent.sessionId, subagent.usage, id);
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

  async #meter(
    runId: string,
    sessionId: string | null,
    usage: RunUsage,
    id: string,
    weekly: number | null = null
  ) {
    try {
      await this.#engine.dispatch(
        { type: 'run.meter', runId, sessionId, usage, ...(weekly ? { weeklyPercent: weekly } : {}) },
        { id }
      );
    } catch (error) {
      log.warn('[Runs] Could not record what a run cost', { runId, error: describeError(error) });
    }
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
    active.stopping = true;
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
    const earlier: ActiveRun[] = [];
    for (const [id, active] of this.#active) {
      if (id === except) break;
      if (active.taskId === taskId && !(except && active.delegated)) earlier.push(active);
    }
    return earlier;
  }

  async quiesce(taskId: string, except?: string) {
    const earlier = this.#listEarlier(taskId, except);
    if (earlier.length === 0) return;
    const timeout = Promise.withResolvers<'timeout'>();
    const timer = setTimeout(() => timeout.resolve('timeout'), this.#quiesceMs);
    const settled = Promise.all(earlier.map((active) => active.done)).then(() => 'settled' as const);
    try {
      if ((await Promise.race([settled, timeout.promise])) === 'settled') return;
    } finally {
      clearTimeout(timer);
    }
    await Promise.allSettled(earlier.map((active) => active.session?.cancel()));
  }

  async steer(runId: string, text: string, cause?: string) {
    const run = this.#engine.state.runs[runId];
    if (!run) return;
    const active = this.#active.get(runId);
    if (run.endedAt === null && active && isSteerable(active)) {
      if (!active.session) {
        active.queued.push(text);
        return;
      }
      if (active.session.steer(text)) return;
    }
    await this.#engine.dispatch(
      { type: 'message.deliver', taskId: run.taskId, text },
      cause === undefined ? {} : { id: `${cause}:message.deliver` }
    );
  }

  async cancel(runId: string) {
    const active = this.#active.get(runId);
    if (!active) return;
    active.stopping = true;
    await active.session?.cancel();
  }

  async interruptForShutdown() {
    this.#shuttingDown = true;
    const compacting = this.#compaction.stop();
    const live = [...this.#active.entries()];
    for (const [runId, active] of live) {
      const continuations = this.#engine.state.runs[runId]?.continuations?.length ?? 0;
      const attempt = active.attemptId ?? `${runId}:0:${continuations}`;
      try {
        await this.#engine.dispatch(
          { type: 'run.interrupt', runId, attemptId: active.attemptId },
          { id: `run.interrupt:${attempt}` }
        );
      } catch (error) {
        log.warn('[Runs] Could not mark a run to resume after the restart', {
          runId,
          error: describeError(error),
        });
      }
    }
    await Promise.allSettled(
      live.map(([, active]) => {
        active.stopping = true;
        return active.session?.cancel();
      })
    );
    await Promise.allSettled([compacting, ...live.map(([, active]) => active.done)]);
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
    const repo = task?.repoId ? state.repos[task.repoId] : undefined;
    const provider = run ? this.#providers.select(run.sessionProvider ?? run.provider) : null;
    const cwd = run && task && repo ? this.#resolveCwd(run, task, repo) : null;
    if (!run || !repo || !cwd || !provider?.compactSession || !resolveCapabilities(provider).compaction)
      return;
    const id = `idle-compact:${runId}:${sessionId}`;
    const events = await this.#engine.dispatch({ type: 'run.compact', runId, sessionId }, { id });
    if (!events.some((event) => event.type === 'run.compacted')) return;
    const lease = await this.#leasing.leaseSession(run);
    if (signal.aborted) return;
    log.info('[Runs] Compacting an idle session before its prompt cache expires', { runId, sessionId });
    const session = provider.compactSession({
      role: run.role,
      cwd,
      model: run.attempts?.at(-1)?.model ?? run.model,
      resume: sessionId,
      defaultBranch: repo.defaultBranch,
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
    signal.addEventListener('abort', () => this.#cancelCompaction(runId, session), { once: true });
    const result = await session.done;
    if (result.usage) await this.#meter(runId, sessionId, result.usage, `${id}:run.meter`);
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
