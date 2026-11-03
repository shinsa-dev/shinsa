import {
  isDelegatedRun,
  isFoldingCompaction,
  isReadOnlyRun,
  type LoadedExtensions,
  RUN_AGENT_ROLE,
  type Run,
  resolveTaskProject,
} from '@shinsa/core';
import { Clock, Effect, FiberSet, Scope } from 'effect';
import { isSameExtensionSet } from '../../extensions/index.ts';
import { describeError } from '../../log/index.ts';
import type { AccountLease } from '../accounts.ts';
import type { ActiveRun } from '../active/schema.ts';
import { listSurfaceToolSpecs } from '../manage/index.ts';
import {
  type AgentProvider,
  type AgentSession,
  resolveCapabilities,
  resolveSessionOptions,
} from '../providers/index.ts';
import { acquireAgentSession } from '../providers/session/service.ts';
import { createShinsaTools, type ToolHandler } from '../tools/index.ts';
import { isSessionCacheWarm, resolveTurnFold, resolveTurnPrompt } from '../turns/plan.ts';
import type { TurnContext, TurnPlan } from '../turns/schema.ts';
import { recordAttempt, resolveModel } from './attempts.ts';
import { RunHost } from './host/service.ts';
import { meterAttempt } from './meter.ts';
import {
  ExtensionsUnavailable,
  ImageNotKept,
  type RunHostShape,
  SessionStopFailed,
  type Turn,
} from './schema.ts';
import { RunWorld } from './world/service.ts';

export const recordSessionLost = Effect.fn('RunSupervisor.recordSessionLost')(function* (
  runId: string,
  sessionId: string
) {
  const world = yield* RunWorld;
  yield* world.dispatch(
    { type: 'run.record_lost_session', runId, sessionId },
    { id: `run.record_lost_session:${runId}:${sessionId}` }
  );
});

export const resolveTurnContext = Effect.fn('RunSupervisor.resolveTurnContext')(function* (turn: Turn) {
  const world = yield* RunWorld;
  const state = yield* world.state;
  const context: TurnContext = {
    state,
    run: turn.run,
    provider: turn.provider,
    cwd: turn.cwd,
    transcripts: world.transcripts,
    labelOf: (id) => world.providers.select(id)?.label ?? id,
    recordLost: (sessionId) =>
      Effect.runPromise(
        recordSessionLost(turn.run.id, sessionId).pipe(Effect.provideService(RunWorld, world))
      ),
  };
  return context;
});

export const stopSession = Effect.fn('RunSupervisor.stopSession')(function* (
  runId: string,
  session: AgentSession,
  failure: string
) {
  yield* Effect.tryPromise({
    try: () => session.cancel(),
    catch: (error) => new SessionStopFailed({ message: describeError(error) }),
  }).pipe(
    Effect.catchTag('SessionStopFailed', (stop) =>
      Effect.logWarning(failure).pipe(Effect.annotateLogs({ runId, error: stop.message }))
    )
  );
});

const resolveExtensions = Effect.fn('RunSupervisor.resolveExtensions')(function* (
  run: Run,
  pin: LoadedExtensions | null
) {
  const source = (yield* RunHost).hooks.extensions;
  if (!source) return null;
  const state = yield* (yield* RunWorld).state;
  const task = state.tasks[run.taskId];
  const repo = task?.repoId ? state.repos[task.repoId] : undefined;
  const place = { repoPath: repo?.path ?? null, project: task ? resolveTaskProject(state, task) : null };
  return yield* Effect.tryPromise({
    try: () => source.resolveSession(place, pin),
    catch: (error) => new ExtensionsUnavailable({ message: describeError(error) }),
  }).pipe(
    Effect.catchTag('ExtensionsUnavailable', (failure) =>
      Effect.logWarning('[Runs] Could not resolve the MCP servers and skills for a run').pipe(
        Effect.annotateLogs({ runId: run.id, error: failure.message }),
        Effect.as(null)
      )
    )
  );
});

export const listServerNames = Effect.fn('RunSupervisor.listServerNames')(function* (run: Run) {
  const extensions = yield* resolveExtensions(run, null);
  if (!extensions) return [];
  const names = [...extensions.servers, ...extensions.deferred].flatMap((server) => [
    server.name,
    server.claudeName,
  ]);
  const keys = names.map((name) => name.toLowerCase());
  return names.filter((name, index) => keys.indexOf(name.toLowerCase()) === index);
});

export const resolveSpeed = Effect.fn('RunSupervisor.resolveSpeed')(function* (
  run: Run,
  provider: AgentProvider,
  lease: AccountLease | null,
  notify: boolean
) {
  const world = yield* RunWorld;
  const state = yield* world.state;
  const options = resolveSessionOptions(state.settings, provider, RUN_AGENT_ROLE[run.role]);
  if (!options.fastMode) return options;
  const availability = yield* Effect.promise(() => world.leasing.readFastMode(lease, provider.id));
  if (availability === 'available') return options;
  if (notify) {
    const reason = availability === 'needs_credits' ? 'needs_credits' : 'credits_unknown';
    yield* world.recordEntry(run.id, {
      type: 'notice',
      notice: { kind: 'fast_mode', status: 'unavailable', reason },
    });
  }
  return { ...options, fastMode: false };
});

export const readSessionUsage = Effect.fn('RunSupervisor.readSessionUsage')(function* () {
  const world = yield* RunWorld;
  return (sessionId: string) => Effect.runSync(world.state).sessionUsage[sessionId] ?? null;
});

const steerWaiting = Effect.fn('RunSupervisor.steerWaiting')(function* (
  runId: string,
  active: ActiveRun,
  session: AgentSession
) {
  const host = yield* RunHost;
  for (const text of active.queued.splice(0)) {
    if (!session.steer(text)) active.unsent.push(text);
  }
  for (const text of active.resteered.splice(0)) {
    if (!session.steer(text, 'shinsa')) active.unsteered.push(text);
  }
  for (const delivery of active.held.splice(0)) {
    yield* Effect.promise(() => host.deliveries.steer(runId, active, delivery));
  }
});

const linkSession = Effect.fn('RunSupervisor.linkSession')(function* (
  run: Run,
  attemptId: string,
  provider: string,
  sessionId: string
) {
  if (sessionId === run.sessionId && provider === (run.sessionProvider ?? run.provider)) return;
  const world = yield* RunWorld;
  yield* world
    .dispatch(
      { type: 'run.link', runId: run.id, sessionId, attemptId, provider },
      { id: `run.link:${attemptId}:${sessionId}` }
    )
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning('[Runs] Could not link session').pipe(
          Effect.annotateLogs({ runId: run.id, error: describeError(error) })
        )
      )
    );
});

const storeImage = (host: RunHostShape) => (data: string, mediaType: string) => {
  const stored = Effect.try({
    try: () => host.evidence.writeImage(data, mediaType),
    catch: (error) => new ImageNotKept({ message: describeError(error) }),
  }).pipe(
    Effect.catchTag('ImageNotKept', (failure) =>
      Effect.logWarning('[Runs] Could not keep a tool image').pipe(
        Effect.annotateLogs({ error: failure.message }),
        Effect.as(null)
      )
    )
  );
  return stored;
};

export const attemptTurn = Effect.fn('RunSupervisor.attempt')(function* (turn: Turn, plan: TurnPlan) {
  const world = yield* RunWorld;
  const host = yield* RunHost;
  const fork = yield* FiberSet.runtime(host.fibers)<RunWorld | RunHost>();
  const { run, active, provider } = turn;
  const firstAttempt = ((yield* world.state).runs[run.id]?.attempts ?? []).length === 0;
  const { attemptId, account } = yield* recordAttempt(turn, plan);
  const weeklyBefore = world.leasing.readWeeklyReading(run.id, active.lease, provider.id, false);
  const pin = plan.resume ? host.extensionSets.select(plan.resume) : null;
  const extensions = yield* resolveExtensions(run, pin);
  const loader = extensions ? (host.hooks.extensions?.createLoader?.(extensions) ?? null) : null;
  const handleTool: ToolHandler = (name, input, signal, requestId) => {
    if (loader?.isLoaderTool(name)) return loader.handle(name, input);
    return host.tools.handle(name, { runId: run.id, attemptId, input, signal, requestId });
  };
  const startSession = host.hooks.startSession ?? provider.startSession;
  let sessionId = plan.fork ? null : plan.resume;
  const options = yield* resolveSpeed(run, provider, active.lease, true);
  const releases: (() => void)[] = [];
  const fold = resolveTurnFold({
    run,
    plan,
    stepPrompt: turn.stepPrompt,
    firstAttempt,
    folds: resolveCapabilities(provider).folds && isFoldingCompaction(options.compaction ?? 'off'),
  });
  const context = yield* resolveTurnContext(turn);
  const prompt = resolveTurnPrompt(context, plan, turn.prompt, turn.brief, fold);
  const model = yield* resolveModel(turn);
  const now = yield* Clock.currentTimeMillis;
  const usageBaseline = yield* readSessionUsage();
  const keep = storeImage(host);
  const scope = yield* host.scopes.open({
    taskId: run.taskId,
    runId: run.id,
    parentRunId: run.delegation?.parentRunId ?? null,
    fiber: active.fiber,
  });
  const start = () =>
    startSession({
      role: run.role,
      readOnly: isReadOnlyRun(run),
      cwd: turn.cwd,
      prompt,
      model,
      resume: plan.resume,
      fork: plan.fork,
      defaultBranch: turn.defaultBranch,
      pluginDir: world.config.pluginDir,
      tools: createShinsaTools(run.role, handleTool, run.delegation?.depth ?? 0, [
        ...(host.hooks.manages && !isDelegatedRun(run) ? listSurfaceToolSpecs() : []),
        ...(loader?.listSpecs() ?? []),
      ]),
      ...(extensions
        ? { extensions, announceExtensions: !pin || !isSameExtensionSet(pin, extensions.loaded) }
        : {}),
      ...options,
      ...(fold && plan.resume ? { fold, cacheWarm: isSessionCacheWarm(context, plan.resume, now) } : {}),
      ...(active.lease ? { account: { id: active.lease.id, configDir: active.lease.configDir } } : {}),
      usageBaseline,
      onSession: (linked) => {
        sessionId = linked;
        if (extensions) host.extensionSets.record(linked, extensions.loaded);
        fork(linkSession(run, attemptId, provider.id, linked));
        host.deliveries.confirmWake(run.id, active);
      },
      onEntry: (entry) => Effect.runSync(world.recordEntry(run.id, entry)),
      onActivity: () => host.questions.touch(run.id),
      onProcess: (pid) => {
        if (host.hooks.trackProcess) releases.push(host.hooks.trackProcess(run.taskId, 'agent', pid));
      },
      storeImage: (data, mediaType) => Effect.runSync(keep(data, mediaType)),
    });
  const scoped = yield* acquireAgentSession(start).pipe(Scope.provide(scope));
  active.session = scoped.session;
  loader?.attach(scoped.session);
  const closeAttempt = Effect.gen(function* () {
    active.session = null;
    yield* host.scopes.close(run.id);
    for (const release of releases) release();
    if (loader) yield* Effect.promise(() => loader.close());
  });
  const driven = Effect.gen(function* () {
    yield* steerWaiting(run.id, active, scoped.session);
    const result = yield* scoped.done;
    yield* meterAttempt(turn, attemptId, sessionId, result, weeklyBefore);
    if (!account || !result.failure) return { attemptId, result };
    return { attemptId, result: { ...result, failure: { ...result.failure, account } } };
  });
  return yield* driven.pipe(Effect.ensuring(closeAttempt));
});
