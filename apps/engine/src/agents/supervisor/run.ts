import {
  isDelegatedRun,
  isReadOnlyRun,
  RUN_AGENT_ROLE,
  type Run,
  resolveAgentProvider,
  type ShinsaCommand,
} from '@shinsa/core';
import { Effect, Ref } from 'effect';
import { stashEdits } from '../../git/index.ts';
import { describeError } from '../../log/index.ts';
import { createActiveRun, resolveAttemptKey } from '../active/run.ts';
import type { ActiveRun } from '../active/schema.ts';
import type { Delivery } from '../delegations/schema.ts';
import { type AgentProvider, type AgentSessionResult, resolveCapabilities } from '../providers/index.ts';
import { resolveTurnBrief } from '../turns/plan.ts';
import { prepareAndDrive, resolveDelegatedResult } from './drive.ts';
import { RunHost } from './host/service.ts';
import { EditsNotSetAside, NO_WORKTREE, type Turn, type Workspace } from './schema.ts';
import { markInterrupted, quiesceTask } from './stop.ts';
import { isSharedCheckout, prepareWorkspace, resolveWorkspace } from './workspace.ts';
import { RunWorld } from './world/service.ts';

const endRun = Effect.fn('RunSupervisor.end')(function* (
  runId: string,
  result: AgentSessionResult,
  attemptId: string | null
) {
  const world = yield* RunWorld;
  world.transcripts.record(runId, { type: 'status', status: 'ended', outcome: result.outcome });
  const command: ShinsaCommand = {
    type: 'run.end',
    runId,
    outcome: result.outcome,
    summary: result.summary,
    ...(attemptId ? { attemptId } : {}),
    ...(result.failure ? { failure: result.failure } : {}),
    ...(result.context?.cacheExpiresAt ? { cacheExpiresAt: result.context.cacheExpiresAt } : {}),
  };
  yield* world.dispatch(command, { id: `run.end:${attemptId ?? runId}` });
});

const redeliver = Effect.fn('RunSupervisor.redeliver')(function* (
  taskId: string,
  attemptKey: string,
  texts: string[]
) {
  const world = yield* RunWorld;
  for (const [index, text] of texts.entries()) {
    yield* world.dispatch(
      { type: 'message.deliver', taskId, text },
      { id: `message.deliver:${attemptKey}:${index}` }
    );
  }
});

const reportUndelivered = Effect.fn('RunSupervisor.reportUndelivered')(function* (
  runId: string,
  active: ActiveRun,
  result: AgentSessionResult
) {
  const count =
    active.queued.length +
    active.unsent.length +
    active.resteered.length +
    active.unsteered.length +
    (result.undelivered?.length ?? 0);
  if (count === 0) return;
  yield* Effect.logWarning('[Runs] Messages that never reached the agent before Shinsa stopped').pipe(
    Effect.annotateLogs({ runId, count })
  );
});

const discardEdits = Effect.fn('RunSupervisor.discardEdits')(function* (path: string, role: string) {
  const stashed = yield* Effect.tryPromise({
    try: () => stashEdits(path, `shinsa: edits by the ${role}`),
    catch: (error) => new EditsNotSetAside({ message: describeError(error) }),
  }).pipe(
    Effect.catchTag('EditsNotSetAside', (failure) =>
      Effect.logWarning('[Runs] Could not set aside edits by a read-only agent').pipe(
        Effect.annotateLogs({ role, path, error: failure.message }),
        Effect.as(false)
      )
    )
  );
  if (!stashed) return;
  yield* Effect.logWarning('[Runs] A read-only agent changed files; set them aside').pipe(
    Effect.annotateLogs({ role, path })
  );
});

const settleRun = Effect.fn('RunSupervisor.settle')(function* (
  runId: string,
  active: ActiveRun,
  result: AgentSessionResult
) {
  const host = yield* RunHost;
  if ((yield* Ref.get(host.control)).shuttingDown) return yield* reportUndelivered(runId, active, result);
  const returned = [...active.unsteered, ...(result.undelivered ?? [])];
  const undelivered = yield* Effect.promise(() => host.deliveries.release(runId, active, returned));
  if (active.released) return;
  yield* endRun(runId, result, active.attemptId);
  host.compaction.record(runId, result.context ?? null);
  if (!active.delegated) host.compaction.schedule(active.taskId);
  yield* redeliver(active.taskId, resolveAttemptKey(runId, active.attemptId), [
    ...active.unsent,
    ...active.queued,
    ...undelivered,
  ]);
});

const runTurn = Effect.fn('RunSupervisor.runTurn')(function* (
  run: Run,
  workspace: Workspace,
  provider: AgentProvider,
  active: ActiveRun,
  override: string | null
) {
  const world = yield* RunWorld;
  const host = yield* RunHost;
  if (!active.delegated) yield* Effect.promise(() => host.compaction.settle(run.taskId));
  if (!active.delegated) yield* quiesceTask(run.taskId, run.id);
  const state = yield* world.state;
  const current = state.runs[run.id];
  if (!current || current.endedAt !== null || (yield* Ref.get(host.control)).shuttingDown) return null;
  const { cwd, defaultBranch } = yield* prepareWorkspace(workspace);
  const turn: Turn = {
    run: current,
    cwd,
    defaultBranch,
    prompt: override ?? run.prompt ?? '',
    brief: resolveTurnBrief(state, current, override),
    stepPrompt: override === null,
    provider,
    active,
  };
  const result = yield* prepareAndDrive(turn, workspace.repo);
  if (isReadOnlyRun(run) && !isSharedCheckout(run, workspace)) yield* discardEdits(cwd, run.role);
  if (isDelegatedRun(current)) return yield* resolveDelegatedResult(current, cwd, result);
  return result;
});

export const executeRun = Effect.fn('RunSupervisor.execute')(function* (
  runId: string,
  override: string | null,
  delivery: Delivery | null
) {
  const world = yield* RunWorld;
  const host = yield* RunHost;
  const state = yield* world.state;
  const run = state.runs[runId];
  if (!run || run.endedAt !== null || host.active.has(runId)) return;
  const control = yield* Ref.get(host.control);
  if (control.shuttingDown) return yield* markInterrupted(runId, null);
  if (control.holding && override === null && delivery === null) {
    const holding = yield* Ref.modify(host.control, (current) => {
      if (current.held.has(runId)) return [null, current] as const;
      return [current.holding, { ...current, held: new Set(current.held).add(runId) }] as const;
    });
    holding?.();
    return;
  }
  const task = state.tasks[run.taskId];
  const workspace = task ? resolveWorkspace(state, world.config, run, task) : null;
  if (!task || !workspace) return yield* endRun(runId, { outcome: 'failed', summary: NO_WORKTREE }, null);
  const delegated = isDelegatedRun(run);
  const provider = world.providers.resolve(
    delegated ? run.provider : resolveAgentProvider(state.settings, RUN_AGENT_ROLE[run.role])
  );
  const released = Promise.withResolvers<void>();
  const active = createActiveRun(task.id, released.promise, {
    steerable: resolveCapabilities(provider).turns.steering,
    delegated,
    delivery,
  });
  active.fiber = yield* Effect.fiber;
  host.active.set(runId, active);
  const release = Effect.sync(() => {
    if (host.active.get(runId) === active) host.active.delete(runId);
    host.questions.forget(runId);
    released.resolve();
  });
  const result = yield* runTurn(run, workspace, provider, active, override).pipe(Effect.ensuring(release));
  if (result) yield* settleRun(runId, active, result);
});
