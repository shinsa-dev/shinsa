import type { Task, TaskStage } from '../domain/types.ts';

export type ShareUpdate =
  | 'planning'
  | 'working'
  | 'ready'
  | 'deploying'
  | 'live'
  | 'looking_into'
  | 'answered'
  | 'done'
  | 'closed';

const STAGE_UPDATE: Record<TaskStage, ShareUpdate> = {
  triage: 'planning',
  waiting_on_tasks: 'planning',
  planning: 'planning',
  awaiting_plan: 'planning',
  building: 'working',
  checking: 'working',
  reviewing: 'working',
  fixing: 'working',
  operating: 'working',
  awaiting_review: 'ready',
  shipping: 'ready',
  awaiting_merge: 'ready',
  answering: 'looking_into',
  investigating: 'looking_into',
  researching: 'looking_into',
  watching: 'looking_into',
  awaiting_proposal: 'looking_into',
  awaiting_operation: 'looking_into',
  answered: 'answered',
  merged: 'live',
  done: 'done',
  cancelled: 'closed',
};

const RELEASED_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>(['merged', 'done', 'watching']);

function isAwaitingProduction(task: Task) {
  return (task.watchdogs ?? []).some((watchdog) => watchdog.status === 'awaiting_production');
}

export function resolveShareUpdate(task: Task): ShareUpdate {
  const shipped = task.stage === 'merged' || task.pullRequest?.state === 'merged';
  if (shipped && RELEASED_STAGES.has(task.stage)) return isAwaitingProduction(task) ? 'deploying' : 'live';
  return STAGE_UPDATE[task.stage];
}
