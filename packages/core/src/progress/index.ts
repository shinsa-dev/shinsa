import type { Task, TaskStage } from '../model/index.ts';

export type DisplayPhaseStatus = 'done' | 'active' | 'waiting' | 'pending' | 'skipped';

export interface DisplayPhase {
  key: string;
  title: string;
  detail: string | null;
  status: DisplayPhaseStatus;
  planned: boolean;
}

export interface TaskProgress {
  phases: DisplayPhase[];
  current: DisplayPhase | null;
  position: number;
  total: number;
  done: number;
}

const STAGE_RANK: Record<TaskStage, number> = {
  triage: 0,
  queued: 0,
  planning: 1,
  awaiting_spec: 1,
  building: 2,
  checking: 3,
  reviewing: 3,
  fixing: 3,
  awaiting_review: 4,
  shipping: 5,
  awaiting_merge: 6,
  merged: 7,
  done: 7,
  cancelled: -1,
};

function resolveSystemStatus(task: Task, rank: number, waitingStage: TaskStage | null): DisplayPhaseStatus {
  const current = STAGE_RANK[task.stage];
  if (task.stage === 'cancelled') return 'pending';
  if (current > rank) return 'done';
  if (current < rank) return 'pending';
  return waitingStage === task.stage ? 'waiting' : 'active';
}

function resolvePlanPhases(task: Task): DisplayPhase[] {
  const plan = task.spec?.document?.plan ?? [];
  const built = STAGE_RANK[task.stage] > STAGE_RANK.building;
  if (plan.length === 0) {
    return [
      {
        key: 'build',
        title: 'Build',
        detail: null,
        status: resolveSystemStatus(task, STAGE_RANK.building, null),
        planned: false,
      },
    ];
  }
  const building = task.stage === 'building';
  const anyActive = task.phases.some((phase) => phase.status === 'active');
  let firstOpen = true;
  return plan.map((step, index) => {
    const progress = task.phases[index]?.status ?? 'pending';
    let status: DisplayPhaseStatus = progress;
    if (built && progress !== 'skipped') status = 'done';
    else if (!built && progress === 'pending' && building && !anyActive && firstOpen) status = 'active';
    if (progress === 'pending') firstOpen = false;
    return { key: `plan-${index}`, title: step.title, detail: step.detail, status, planned: true };
  });
}

export function resolveTaskProgress(task: Task): TaskProgress {
  const phases: DisplayPhase[] = [
    {
      key: 'plan',
      title: 'Plan',
      detail: task.stage === 'queued' ? 'Starts when the task it waits on finishes' : null,
      status: resolveSystemStatus(task, STAGE_RANK.planning, 'awaiting_spec'),
      planned: false,
    },
    ...resolvePlanPhases(task),
    {
      key: 'check',
      title: 'Checks and agent review',
      detail: null,
      status: resolveSystemStatus(task, STAGE_RANK.checking, null),
      planned: false,
    },
    {
      key: 'review',
      title: 'Your review',
      detail: null,
      status: resolveSystemStatus(task, STAGE_RANK.awaiting_review, 'awaiting_review'),
      planned: false,
    },
    {
      key: 'pull-request',
      title: 'Pull request',
      detail: null,
      status: resolveSystemStatus(task, STAGE_RANK.shipping, null),
      planned: false,
    },
    {
      key: 'merge',
      title: 'Merge',
      detail: null,
      status: resolveSystemStatus(task, STAGE_RANK.awaiting_merge, 'awaiting_merge'),
      planned: false,
    },
  ];
  const currentIndex = phases.findIndex((phase) => phase.status === 'active' || phase.status === 'waiting');
  const done = phases.filter((phase) => phase.status === 'done' || phase.status === 'skipped').length;
  return {
    phases,
    current: currentIndex === -1 ? null : (phases[currentIndex] ?? null),
    position: currentIndex === -1 ? done : currentIndex + 1,
    total: phases.length,
    done,
  };
}
