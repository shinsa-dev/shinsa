import {
  isDelegatedRun,
  isFoldingCompaction,
  isReadOnlyRun,
  type LoadedExtensions,
  RUN_AGENT_ROLE,
  type Run,
  resolveTaskProject,
} from '@shinsa/core';
import { Clock, Effect, FiberSet, Scope, Option } from 'effect';
import { isSameExtensionSet } from '../../extensions/index.ts';
import { describeError } from '../../log/index.ts';
import type { AccountLease } from '../accounts/schema.ts';
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
import { ToolCallFailed } from '../tools/schema.ts';
import { isSessionCacheWarm, resolveTurnFold, resolveTurnPrompt } from '../turns/plan.ts';
import type { TurnContext, TurnPlan } from '../turns/schema.ts';
import { recordAttempt, resolveModel } from './attempts.ts';
import { RunHost } from './host/service.ts';
import { meterAttempt } from './meter.ts';
import { ExtensionsUnavailable, ImageNotKept, type RunHostShape, type Turn } from './schema.ts';
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
      recordSessionLost(turn.run.id, sessionId).pipe(Effect.provideService(RunWorld, world), Effect.orDie),
  };
  return context;
});

export const stopSession = Effect.fn('RunSupervisor.stopSession')(function* (
  runId: string,
  session: AgentSession,
  failure: string
) {
  yield* session.cancel.pipe(
    Effect.catchDefect((error) =>
      Effect.logWarning(failure).pipe(Effect.annotateLogs({ runId, error: describeError(error) }))
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
  const place = {
    repoPath: repo?.path ?? null,
    project: task ? Option.getOrNull(resolveTaskProject(state, task)) : null,
  };
  return yield* source.resolveSession(place, pin).pipe(
    Effect.catchDefect((defect) =>
      Effect.fail(new ExtensionsUnavailable({ message: describeError(defect) }))
    ),
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
  const availability = yield* world.leasing.readFastMode(lease, provider.id).pipe(Effect.orDie);
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
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  return (sessionId: string) => runSync(world.state).sessionUsage[sessionId] ?? null;
});

const steerWaiting = Effect.fn('RunSupervisor.steerWaiting')(function* (
  runId: string,
  active: ActiveRun,
  session: AgentSession
) {
  const host = yield* RunHost;
  for (const text of active.queued.splice(0)) {
    if (!(yield* session.steer(text))) active.unsent.push(text);
  }
  for (const text of active.resteered.splice(0)) {
    if (!(yield* session.steer(text, 'shinsa'))) active.unsteered.push(text);
  }
  for (const delivery of active.held.splice(0)) {
    yield* host.deliveries.steer(runId, active, delivery);
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
  const stored = host.evidence.writeImage(data, mediaType).pipe(
    Effect.catchDefect((error) => Effect.fail(new ImageNotKept({ message: describeError(error) }))),
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
  const weeklyBefore = yield* Effect.forkChild(
    world.leasing.readWeeklyReading(run.id, active.lease, provider.id, false)
  );
  const pin = plan.resume ? yield* host.extensionSets.select(plan.resume) : null;
  const extensions = yield* resolveExtensions(run, pin);
  const createLoader = host.hooks.extensions?.createLoader;
  const loader = yield* Effect.suspend(() =>
    extensions && createLoader ? createLoader(extensions) : Effect.succeed(null)
  );
  const context = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(context);
  const handleTool: ToolHandler = (name, input, signal, requestId) => {
    if (loader?.specs.some((spec) => spec.name === name))
      return loader.handle(name, input).pipe(
        Effect.catchTags({
          ExtensionLoadFailed: (failure) => Effect.fail(new ToolCallFailed({ message: failure.message })),
          McpServerFailed: (failure) => Effect.fail(new ToolCallFailed({ message: failure.message })),
        })
      );
    return host.tools.handle(name, { runId: run.id, attemptId, input, signal, requestId });
  };
  const tools = yield* createShinsaTools(run.role, handleTool, run.delegation?.depth ?? 0, [
    ...(host.hooks.manages && !isDelegatedRun(run) ? listSurfaceToolSpecs() : []),
    ...(loader?.specs ?? []),
  ]);
  const startSession = host.hooks.startSession ?? provider.startSession;
  let sessionId = plan.fork ? null : plan.resume;
  const options = yield* resolveSpeed(run, provider, active.lease, true);
  const releases: Effect.Effect<void>[] = [];
  const fold = resolveTurnFold({
    run,
    plan,
    stepPrompt: turn.stepPrompt,
    firstAttempt,
    folds: resolveCapabilities(provider).folds && isFoldingCompaction(options.compaction ?? 'off'),
  });
  const turnContext = yield* resolveTurnContext(turn);
  const prompt = yield* resolveTurnPrompt(turnContext, plan, turn.prompt, turn.brief, fold);
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
  const start = startSession({
    role: run.role,
    readOnly: isReadOnlyRun(run),
    cwd: turn.cwd,
    prompt,
    model,
    resume: plan.resume,
    fork: plan.fork,
    defaultBranch: turn.defaultBranch,
    pluginDir: world.config.pluginDir,
    tools,
    ...(extensions
      ? { extensions, announceExtensions: !pin || !isSameExtensionSet(pin, extensions.loaded) }
      : {}),
    ...options,
    ...(fold && plan.resume ? { fold, cacheWarm: isSessionCacheWarm(turnContext, plan.resume, now) } : {}),
    ...(active.lease ? { account: { id: active.lease.id, configDir: active.lease.configDir } } : {}),
    usageBaseline,
    onSession: (linked) => {
      sessionId = linked;
      if (extensions) runSync(host.extensionSets.record(linked, extensions.loaded));
      fork(linkSession(run, attemptId, provider.id, linked));
      runSync(host.deliveries.confirmWake(run.id, active));
    },
    onEntry: (entry) => runSync(world.recordEntry(run.id, entry)),
    onActivity: () => runSync(host.questions.touch(run.id)),
    onProcess: (pid) => {
      if (host.hooks.trackProcess) releases.push(runSync(host.hooks.trackProcess(run.taskId, 'agent', pid)));
    },
    storeImage: (data, mediaType) => runSync(keep(data, mediaType)),
  });
  const resources = yield* Scope.fork(scope);
  const scoped = yield* acquireAgentSession(start.pipe(Scope.provide(resources))).pipe(Scope.provide(scope));
  active.session = scoped.session;
  if (loader) yield* loader.attach(scoped.session);
  const closeAttempt = Effect.gen(function* () {
    active.session = null;
    yield* host.scopes.close(run.id);
    for (const release of releases) yield* release;
    if (loader) yield* loader.close;
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
