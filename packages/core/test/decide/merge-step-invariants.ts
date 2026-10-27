import { expect } from 'bun:test';
import {
  type Gate,
  isSamePipeline,
  isTaskClosed,
  isTaskResting,
  listMergeSteps,
  type MergeStep,
  type ReportWalkthrough,
  resolveCurrentRound,
  resolveHandOverPipeline,
  resolveTaskPipeline,
  type ShinsaCommand,
  type ShinsaState,
  type Task,
} from '../../src/index.ts';

const STEPS: MergeStep[] = [
  {
    when: 'pre_merge',
    kind: 'env',
    title: 'Set RETRY_LIMIT in production',
    detail: 'On the API service.',
    command: null,
  },
  {
    when: 'post_merge',
    kind: 'deploy',
    title: 'Restart the workers',
    detail: 'They read the limit on start.',
    command: 'fly apps restart api',
  },
  {
    when: 'post_merge',
    kind: 'other',
    title: 'Tell support',
    detail: 'The retry message changed.',
    command: null,
  },
];

const STEP_SETS: MergeStep[][] = [[], [], [STEPS[1] as MergeStep], STEPS, [STEPS[2] as MergeStep]];

function pickMergeSteps(seed: string): MergeStep[] {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return STEP_SETS[hash % STEP_SETS.length] ?? [];
}

export function resolvePhaseWalkthrough(runId: string): { walkthrough?: ReportWalkthrough } {
  const steps = pickMergeSteps(runId);
  if (steps.length === 0) return {};
  return {
    walkthrough: {
      approach: 'Retry with a limit.',
      flow: 'send → retry → give up',
      risks: [],
      testing: { automated: [], manual: [] },
      steps,
    },
  };
}

export function resolveFixWalkthrough(runId: string): { walkthrough?: { steps: MergeStep[] } } {
  return runId.endsWith('7') ? { walkthrough: { steps: pickMergeSteps(`${runId}fix`) } } : {};
}

export function listMergeStepCommands(state: ShinsaState): ShinsaCommand[] {
  return Object.values(state.tasks).flatMap((task) =>
    listMergeSteps(task)
      .filter((step) => step.due)
      .map((step) => ({
        type: 'merge_step.tick' as const,
        taskId: task.id,
        key: step.key,
        done: !step.done || state.seq % 5 === 0,
      }))
  );
}

function hasDuePostMergeSteps(task: Task) {
  const round = resolveCurrentRound(task).number;
  return listMergeSteps(task).some(
    (step) =>
      step.when === 'post_merge' && step.due && !step.done && (step.round !== round || isTaskResting(task))
  );
}

export function assertMergeStepInvariants(task: Task, gates: Gate[], context: string) {
  const steps = listMergeSteps(task);
  const round = resolveCurrentRound(task).number;
  const pipeline = resolveTaskPipeline(task);
  if (task.stage !== 'cancelled') {
    const listed = {
      before: steps.some((step) => step.when === 'pre_merge' && (step.round === round || step.due)),
      after: steps.some((step) => step.when === 'post_merge' && step.round === round),
    };
    expect(
      isSamePipeline(resolveHandOverPipeline(pipeline, listed), pipeline),
      `${context}: the steps around the merge and the pipeline disagree: ${pipeline.join(',')}`
    ).toBe(true);
  }
  const postMerge = gates.filter((gate) => gate.type === 'post_merge');
  expect(postMerge.length, `${context}: at most one gate after the merge`).toBeLessThanOrEqual(1);
  expect(
    postMerge.length === 1,
    `${context}: a gate after the merge exactly while a due step after it is open`
  ).toBe(!isTaskClosed(task) && hasDuePostMergeSteps(task));
  if (task.stage === 'done' && task.closedAt) {
    expect(hasDuePostMergeSteps(task), `${context}: marked done with steps left after the merge`).toBe(false);
  }
}

export function listMergeStepMarks(state: ShinsaState) {
  const gates = Object.values(state.gates);
  return Object.values(state.tasks).flatMap((task) => [
    gates.some((gate) => gate.taskId === task.id && gate.type === 'post_merge')
      ? 'gate after the merge'
      : null,
    listMergeSteps(task).some((step) => step.done) ? 'ticked merge step' : null,
    (task.carriedMergeSteps ?? []).length > 0 ? 'carried merge step' : null,
  ]);
}
