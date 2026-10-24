import {
  isDelegatedRun,
  isTaskSettled,
  listLiveRuns,
  listOpenGates,
  type Run,
  type RunRole,
  resolveIdleCompaction,
  type ShinsaState,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { MINUTE_MS } from './clock.ts';
import type { SessionContext } from './providers/index.ts';

export const COMPACTION_NEAR_LIMIT = 0.8;

const RESUMED_ROLES = new Set<RunRole>([
  'builder',
  'fixer',
  'shipper',
  'answerer',
  'investigator',
  'researcher',
  'operator',
]);

interface CompactionWindow {
  runId: string;
  sessionId: string;
  startAt: number;
}

function isLatestResumable(state: ShinsaState, run: Run) {
  return !Object.values(state.runs).some(
    (other) =>
      other.id !== run.id &&
      other.taskId === run.taskId &&
      RESUMED_ROLES.has(other.role) &&
      !isDelegatedRun(other) &&
      other.startedAt > run.startedAt
  );
}

function isNearLimit({ usedTokens, maxTokens }: SessionContext) {
  return usedTokens !== null && maxTokens !== null && usedTokens >= maxTokens * COMPACTION_NEAR_LIMIT;
}

function hasPendingRequest(state: ShinsaState, taskId: string) {
  return listOpenGates(state, taskId).some((gate) => gate.purpose === 'agent_question');
}

export function resolveCompactionWindow(
  state: ShinsaState,
  runId: string,
  context: SessionContext | null,
  now: number
): CompactionWindow | null {
  const run = state.runs[runId];
  const task = run ? state.tasks[run.taskId] : undefined;
  if (!run || !task || !context) return null;
  const settings = resolveIdleCompaction(state.settings, [run.sessionProvider ?? run.provider]);
  if (!settings.enabled) return null;
  const sessionId = run.sessionId;
  if (run.outcome !== 'completed' || !sessionId || run.compactions?.includes(sessionId)) return null;
  if (!RESUMED_ROLES.has(run.role) || isDelegatedRun(run) || task.parentTaskId) return null;
  if (isTaskSettled(task) || listLiveRuns(state, task.id).length > 0 || hasPendingRequest(state, task.id))
    return null;
  if (!isLatestResumable(state, run) || context.backgroundWork) return null;
  if (!isNearLimit(context)) return null;
  const expiresAt = context.cacheExpiresAt;
  if (expiresAt === null || now >= expiresAt) return null;
  return { runId, sessionId, startAt: expiresAt - settings.leadMinutes * MINUTE_MS };
}

type CompactionStarter = (runId: string, sessionId: string, signal: AbortSignal) => Promise<void>;

export interface IdleCompactionOptions {
  now?: () => number;
}

interface PendingCompaction {
  runId: string;
  context: SessionContext;
  timer: ReturnType<typeof setTimeout>;
}

interface LastSession {
  runId: string;
  context: SessionContext | null;
}

interface RunningCompaction {
  done: Promise<void>;
  controller: AbortController;
}

export class IdleCompaction {
  readonly #state: () => ShinsaState;
  readonly #compact: CompactionStarter;
  readonly #now: () => number;
  readonly #last = new Map<string, LastSession>();
  readonly #pending = new Map<string, PendingCompaction>();
  readonly #running = new Map<string, RunningCompaction>();

  constructor(state: () => ShinsaState, compact: CompactionStarter, options: IdleCompactionOptions = {}) {
    this.#state = state;
    this.#compact = compact;
    this.#now = options.now ?? Date.now;
  }

  record(runId: string, context: SessionContext | null) {
    const run = this.#state().runs[runId];
    if (!run || !RESUMED_ROLES.has(run.role) || isDelegatedRun(run)) return;
    this.#last.set(run.taskId, { runId, context });
  }

  schedule(taskId: string) {
    this.cancel(taskId);
    const last = this.#last.get(taskId);
    if (!last) return;
    const state = this.#state();
    const task = state.tasks[taskId];
    if (!task || isTaskSettled(task)) {
      this.#last.delete(taskId);
      return;
    }
    const window = resolveCompactionWindow(state, last.runId, last.context, this.#now());
    if (!window || !last.context) return;
    const timer = setTimeout(() => this.#fire(taskId, last.runId), Math.max(0, window.startAt - this.#now()));
    timer.unref();
    this.#pending.set(taskId, { runId: last.runId, context: last.context, timer });
  }

  cancel(taskId: string) {
    const pending = this.#pending.get(taskId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(taskId);
  }

  async settle(taskId: string) {
    this.cancel(taskId);
    await this.#running.get(taskId)?.done;
  }

  async stop() {
    for (const taskId of [...this.#pending.keys()]) this.cancel(taskId);
    const running = [...this.#running.values()];
    for (const compaction of running) compaction.controller.abort();
    await Promise.allSettled(running.map((compaction) => compaction.done));
  }

  #fire(taskId: string, runId: string) {
    const pending = this.#pending.get(taskId);
    if (pending?.runId !== runId) return;
    this.#pending.delete(taskId);
    const window = resolveCompactionWindow(this.#state(), runId, pending.context, this.#now());
    if (!window) return;
    this.#last.delete(taskId);
    const controller = new AbortController();
    const done = this.#compact(window.runId, window.sessionId, controller.signal)
      .catch((error: unknown) => {
        log.warn('[Compaction] An idle session could not be compacted', {
          runId,
          error: describeError(error),
        });
      })
      .finally(() => {
        this.#running.delete(taskId);
      });
    this.#running.set(taskId, { done, controller });
  }
}
