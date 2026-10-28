import {
  needsRepository,
  type PipelineStep,
  type Round,
  type RoundStatus,
  resolveCurrentRound,
  resolveTaskPipeline,
  resolveWorkStep,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import { resolveChecklistProgress } from '../report/checklist.ts';
import { listMergeSteps, listOpenMergeSteps } from '../report/merge-steps.ts';
import type { MergeStepTiming } from '../report/types.ts';

export type DisplayPhaseStatus = 'done' | 'active' | 'waiting' | 'pending' | 'skipped';

export interface DisplayPhase {
  key: string;
  title: string;
  detail: string | null;
  status: DisplayPhaseStatus;
  planned: boolean;
  count?: { done: number; total: number };
}

export interface TaskProgress {
  phases: DisplayPhase[];
  current: DisplayPhase | null;
  position: number;
  total: number;
  done: number;
}

type DisplayKey =
  | 'setup'
  | 'answer'
  | 'research'
  | 'investigate'
  | 'proposal'
  | 'plan'
  | 'operate'
  | 'build'
  | 'check'
  | 'review'
  | 'pull-request'
  | 'pre-merge'
  | 'merge'
  | 'post-merge';

const STEP_DISPLAY: Record<PipelineStep, DisplayKey> = {
  answer: 'answer',
  research: 'research',
  investigate: 'investigate',
  your_ok: 'proposal',
  plan: 'plan',
  operate: 'operate',
  build: 'build',
  checks: 'check',
  agent_review: 'check',
  your_review: 'review',
  pull_request: 'pull-request',
  pre_merge: 'pre-merge',
  merge: 'merge',
  post_merge: 'post-merge',
};

const DISPLAY_TITLE: Record<DisplayKey, string> = {
  setup: 'Find the repository',
  answer: 'Answer',
  research: 'Research',
  investigate: 'Investigate',
  proposal: 'Your OK to change',
  plan: 'Plan',
  operate: 'Run the operation',
  build: 'Build',
  check: 'Checks and agent review',
  review: 'Your review',
  'pull-request': 'Pull request',
  'pre-merge': 'Pre-merge',
  merge: 'Merge',
  'post-merge': 'Post-merge',
};

const STAGE_DISPLAY: Partial<Record<TaskStage, DisplayKey>> = {
  answering: 'answer',
  researching: 'research',
  investigating: 'investigate',
  awaiting_proposal: 'proposal',
  planning: 'plan',
  awaiting_plan: 'plan',
  operating: 'operate',
  awaiting_operation: 'operate',
  building: 'build',
  checking: 'check',
  reviewing: 'check',
  fixing: 'check',
  awaiting_review: 'review',
  shipping: 'pull-request',
  awaiting_merge: 'merge',
};

const WAITING_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'awaiting_plan',
  'awaiting_review',
  'awaiting_merge',
  'awaiting_proposal',
  'awaiting_operation',
]);

const HAND_OVER_KEYS: ReadonlySet<DisplayKey> = new Set<DisplayKey>(['pre-merge', 'post-merge']);

const FINISHED_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>(['merged', 'done']);

function hasSetupStep(task: Task, pipeline: readonly PipelineStep[]) {
  if (pipeline[0] === 'plan') return false;
  return task.repoId !== null || needsRepository(pipeline);
}

function listDisplayKeys(task: Task): DisplayKey[] {
  const pipeline = resolveTaskPipeline(task);
  const keys: DisplayKey[] = hasSetupStep(task, pipeline) ? ['setup'] : [];
  for (const step of pipeline) {
    const key = STEP_DISPLAY[step];
    if (!keys.includes(key)) keys.push(key);
  }
  if (task.stage === 'awaiting_proposal' && !keys.includes('proposal')) keys.push('proposal');
  return keys;
}

function hasStarted(task: Task) {
  return Boolean(task.result) || task.plan !== null;
}

function isKeyDone(task: Task, key: DisplayKey) {
  if (key === 'setup') return hasStarted(task);
  if (key === 'proposal') return task.proposal?.status === 'accepted';
  return task.result?.step === key;
}

function hasOpenSteps(task: Task, keys: DisplayKey[], when: MergeStepTiming, round: number) {
  const key = when === 'pre_merge' ? 'pre-merge' : 'post-merge';
  if (!keys.includes(key)) return false;
  return listOpenMergeSteps(task, when).some((step) => step.round === round);
}

function resolveStepsKey(task: Task, keys: DisplayKey[]): DisplayKey | null {
  const round = resolveCurrentRound(task).number;
  if (task.stage === 'awaiting_merge' && hasOpenSteps(task, keys, 'pre_merge', round)) return 'pre-merge';
  if (FINISHED_STAGES.has(task.stage) && hasOpenSteps(task, keys, 'post_merge', round)) return 'post-merge';
  return null;
}

function isBuilding(task: Task) {
  const reported = new Set(task.phaseReports.map((report) => report.index)).size;
  return reported < (task.plan?.document?.phases.length ?? 0);
}

function resolveStageKey(task: Task, keys: DisplayKey[]) {
  if (task.stage === 'fixing' && task.fixFor === 'pull_request') return 'pull-request';
  const steps = resolveStepsKey(task, keys);
  if (steps) return steps;
  const key = STAGE_DISPLAY[task.stage];
  if (key !== 'check') return key;
  return keys.includes(key) && !isBuilding(task) ? key : 'build';
}

function resolveCurrentIndex(task: Task, keys: DisplayKey[]) {
  if (task.stage === 'cancelled') return -1;
  const key = resolveStageKey(task, keys);
  if (FINISHED_STAGES.has(task.stage) && key !== 'post-merge') return keys.length;
  if (key) return keys.indexOf(key);
  const first = keys.findIndex((candidate) => !isKeyDone(task, candidate));
  return first === -1 ? keys.length : first;
}

function resolveStatus(
  task: Task,
  keys: DisplayKey[],
  index: number,
  current: number,
  key: DisplayKey
): DisplayPhaseStatus {
  if (current === -1 || index > current) return 'pending';
  if (index < current) return 'done';
  if (resolveStageKey(task, keys) !== key) return key === 'setup' ? 'active' : 'pending';
  return WAITING_STAGES.has(task.stage) || HAND_OVER_KEYS.has(key) ? 'waiting' : 'active';
}

function describeQueuedDetail(task: Task) {
  if (task.waitsOn.length > 1) return 'Starts when the tasks it waits on finish';
  return 'Starts when the task it waits on finishes';
}

const HAND_OVER_TIMING: Partial<Record<DisplayKey, MergeStepTiming>> = {
  'pre-merge': 'pre_merge',
  'post-merge': 'post_merge',
};

function resolveStepCount(task: Task, when: MergeStepTiming) {
  const round = resolveCurrentRound(task).number;
  const steps = listMergeSteps(task).filter((step) => step.when === when && step.round === round);
  const { done, total } = resolveChecklistProgress(steps);
  return { done, total };
}

function resolveDisplayPhase(
  task: Task,
  key: DisplayKey,
  status: DisplayPhaseStatus,
  current: boolean
): DisplayPhase {
  const title = resolveTitle(task, key);
  const timing = HAND_OVER_TIMING[key];
  if (timing) {
    const count = resolveStepCount(task, timing);
    return { key, title, detail: `${count.done} of ${count.total} done`, status, planned: false, count };
  }
  const detail = task.stage === 'waiting_on_tasks' && current ? describeQueuedDetail(task) : null;
  return { key, title, detail, status, planned: false };
}

function resolveCheckTitle(pipeline: readonly PipelineStep[]) {
  if (!pipeline.includes('agent_review')) return 'Checks';
  return pipeline.includes('checks') ? DISPLAY_TITLE.check : 'Agent review';
}

function resolveTitle(task: Task, key: DisplayKey) {
  const pipeline = resolveTaskPipeline(task);
  if (key === 'proposal' && resolveWorkStep(pipeline) === 'operate') return 'Your OK to run';
  if (key === 'check') return resolveCheckTitle(pipeline);
  return DISPLAY_TITLE[key];
}

function resolvePlanPhases(task: Task, status: DisplayPhaseStatus): DisplayPhase[] {
  const plan = task.plan?.document?.phases ?? [];
  if (plan.length === 0) {
    return [{ key: 'build', title: DISPLAY_TITLE.build, detail: null, status, planned: false }];
  }
  const built = status === 'done';
  const building = status === 'active';
  const anyActive = task.phases.some((phase) => phase.status === 'active');
  let firstOpen = true;
  return plan.map((step, index) => {
    const progress = task.phases[index]?.status ?? 'pending';
    let phaseStatus: DisplayPhaseStatus = progress;
    if (built && progress !== 'skipped') phaseStatus = 'done';
    else if (!built && progress === 'pending' && building && !anyActive && firstOpen) phaseStatus = 'active';
    if (progress === 'pending') firstOpen = false;
    return {
      key: `plan-${index}`,
      title: step.title,
      detail: step.detail,
      status: phaseStatus,
      planned: true,
    };
  });
}

export function resolveTaskProgress(task: Task): TaskProgress {
  const keys = listDisplayKeys(task);
  const current = resolveCurrentIndex(task, keys);
  const phases = keys.flatMap((key, index): DisplayPhase[] => {
    const status = resolveStatus(task, keys, index, current, key);
    if (key === 'build') return resolvePlanPhases(task, status);
    return [resolveDisplayPhase(task, key, status, index === current)];
  });
  return summarizeProgress(phases);
}

const ROUND_STEP_STATUS: Record<RoundStatus, (key: DisplayKey) => DisplayPhaseStatus> = {
  waiting: () => 'pending',
  active: () => 'pending',
  shipped: (key) => {
    if (key === 'post-merge') return 'pending';
    return key === 'merge' || key === 'pre-merge' ? 'waiting' : 'done';
  },
  merged: () => 'done',
  finished: () => 'done',
  cancelled: () => 'skipped',
};

function summarizeProgress(phases: DisplayPhase[]): TaskProgress {
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

export function resolveRoundProgress(round: Round): TaskProgress {
  const keys: DisplayKey[] = [];
  for (const step of round.pipeline) {
    const key = STEP_DISPLAY[step];
    if (!keys.includes(key)) keys.push(key);
  }
  const resolveStepStatus = ROUND_STEP_STATUS[round.status];
  const phases = keys.flatMap((key): DisplayPhase[] => {
    const titles = key === 'build' ? (round.outcome?.phases ?? []) : [];
    if (titles.length > 0) {
      return titles.map((phase, index) => ({
        key: `plan-${index}`,
        title: phase,
        detail: null,
        status: resolveStepStatus(key),
        planned: true,
      }));
    }
    const title = key === 'check' ? resolveCheckTitle(round.pipeline) : DISPLAY_TITLE[key];
    return [{ key, title, detail: null, status: resolveStepStatus(key), planned: false }];
  });
  return summarizeProgress(phases);
}
