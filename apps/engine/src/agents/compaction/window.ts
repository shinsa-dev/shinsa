import {
  isAgentQuestion,
  isDelegatedRun,
  isTaskSettled,
  listLiveRuns,
  listOpenGates,
  MINUTE_MS,
  type Run,
  resolveIdleCompaction,
  type ShinsaState,
} from '@shinsa/core';
import type { SessionContext } from '../providers/index.ts';
import { COMPACTION_NEAR_LIMIT, type CompactionWindow, RESUMED_ROLES } from './schema.ts';

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
  return listOpenGates(state, taskId).some(isAgentQuestion);
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
