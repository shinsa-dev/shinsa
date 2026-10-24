import { expect } from 'bun:test';
import {
  type Gate,
  isDelegatedRun,
  isInquiryDone,
  isOfCurrentRound,
  isTaskSettled,
  listActiveRuns,
  listMissingEvidence,
  needsWorktree,
  PIPELINE_ORDER,
  type PipelineStep,
  resolveInquiryStep,
  resolveOperationTiming,
  resolvePresetOf,
  resolveTaskPipeline,
  resolveTaskRounds,
  resolveTaskShape,
  SHAPE_PIPELINES,
  type ShinsaCommand,
  type ShinsaState,
  STEP_SCHEMA,
  TASK_SHAPES,
  type Task,
  type TaskStage,
  validatePipeline,
  validatePlanRules,
  validateVerification,
} from '../../src/index.ts';
import { IMPACT, SPEC } from '../harness.ts';

function resolveStageStep(stage: TaskStage): PipelineStep | null {
  return PIPELINE_ORDER.find((step) => STEP_SCHEMA[step].stages.includes(stage)) ?? null;
}

function hadWorktreeStep(task: Task) {
  return (
    needsWorktree(resolveTaskPipeline(task)) ||
    (task.shapeChanges ?? []).some((change) => needsWorktree(change.from) || needsWorktree(change.to))
  );
}

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function chance(random: Random, odds: number) {
  return random() < odds;
}

const PROPOSAL = { request: 'Change the retry.', why: 'It loops.' };

const REVIEW_TAIL: PipelineStep[] = ['checks', 'agent_review', 'your_review', 'pull_request', 'merge'];

const COMPOSITIONS: PipelineStep[][] = [
  ['investigate', 'your_ok', 'plan', 'operate'],
  ['research', 'your_ok', 'plan', 'build', ...REVIEW_TAIL],
  ['answer', 'your_ok', 'plan', 'operate'],
  ['investigate', 'your_ok', 'plan', 'build', ...REVIEW_TAIL],
  ['investigate', 'plan', 'operate'],
  ['plan', 'build', 'checks', 'agent_review', 'pull_request', 'merge'],
  ['plan', 'build', 'checks', 'agent_review', 'your_review', 'merge'],
  ...TASK_SHAPES.map((shape) => [...SHAPE_PIPELINES[shape]]),
];

const COMBINED_OPEN_TASKS = 4;

const COMBINED: PipelineStep[][] = [
  ['plan', 'build', ...REVIEW_TAIL, 'operate'],
  ['plan', 'operate', 'build', ...REVIEW_TAIL],
  ['plan', 'build', ...REVIEW_TAIL, 'operate'],
  ['investigate', 'your_ok', 'plan', 'build', ...REVIEW_TAIL, 'operate'],
  ['research', 'your_ok', 'plan', 'operate', 'build', ...REVIEW_TAIL],
  ['plan', 'operate', 'build', 'your_review', 'pull_request', 'merge'],
  ['plan', 'build', 'checks', 'your_review', 'pull_request', 'merge', 'operate'],
  ['plan', 'build', 'operate', ...REVIEW_TAIL],
];

const AFTER_YOUR_OK: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'planning',
  'awaiting_plan',
  'operating',
  'building',
]);

function pickComposition(random: Random, combined: boolean): PipelineStep[] {
  if (combined) return pick(random, COMBINED) ?? ['answer'];
  if (chance(random, 0.7)) return pick(random, COMPOSITIONS) ?? ['answer'];
  return PIPELINE_ORDER.filter(() => chance(random, 0.4));
}

const DELIVERING = {
  investigator: 'investigate',
  researcher: 'research',
  operator: 'operate',
} as const;

function listAgentCommands(state: ShinsaState, random: Random, combined: boolean): ShinsaCommand[] {
  return listActiveRuns(state).flatMap((run): ShinsaCommand[] => {
    if (isDelegatedRun(run)) return [];
    const proposal = chance(random, 0.5) ? PROPOSAL : null;
    if (run.role === 'answerer')
      return [{ type: 'agent.answer', runId: run.id, answer: 'Because.', proposal }];
    if (run.role === 'planner' && (combined || chance(random, 0.5))) {
      return [
        {
          type: 'agent.reshape',
          runId: run.id,
          steps: pickComposition(random, combined),
          reason: 'Find it first.',
        },
      ];
    }
    if (run.role === 'planner') {
      return [
        {
          type: 'agent.reshape',
          runId: run.id,
          shape: pick(random, ['answer', 'investigate', 'research'] as const) ?? 'answer',
          reason: 'Nothing to change.',
        },
      ];
    }
    if (run.role === 'investigator' || run.role === 'researcher' || run.role === 'operator') {
      return [
        { type: 'agent.deliver', runId: run.id, step: DELIVERING[run.role], body: 'Found it.', proposal },
      ];
    }
    return [];
  });
}

const OPERATION_PLAN = {
  ...SPEC,
  impact: IMPACT,
  operation: ['Run the backfill and check every row has a plan.'],
};

const MERGED = {
  number: 9,
  url: 'https://github.com/o/r/pull/9',
  checks: 'passing',
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: 0,
} as const;

function listProgressCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const runs = listActiveRuns(state).flatMap((run): ShinsaCommand[] => {
    if (run.role === 'planner')
      return [{ type: 'agent.propose_plan', runId: run.id, document: OPERATION_PLAN }];
    if (run.role === 'builder') {
      return [{ type: 'agent.complete_phase', runId: run.id, summary: 'Done.', spots: [], judgementCalls: [] }];
    }
    if (run.role === 'reviewer') return [{ type: 'agent.report_review', runId: run.id, findings: [] }];
    return [];
  });
  const tasks = Object.values(state.tasks).flatMap((task): ShinsaCommand[] => {
    if (task.stage === 'checking') return [{ type: 'checks.record', taskId: task.id, results: [] }];
    if (task.stage !== 'shipping' && task.stage !== 'awaiting_merge') return [];
    const merged = task.stage === 'awaiting_merge' && chance(random, 0.6);
    return [
      {
        type: 'pull_request.record',
        taskId: task.id,
        pullRequest: { ...MERGED, state: merged ? 'merged' : 'open', mergeCommit: merged ? 'c0ffee1' : null },
      },
    ];
  });
  const gates = Object.values(state.gates).flatMap((gate): ShinsaCommand[] => {
    if (gate.status !== 'open' || !isDecisionGate(gate)) return [];
    return [{ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null }];
  });
  return [...runs, ...tasks, ...gates];
}

export function listShapeCommands(state: ShinsaState, random: Random, combined = false): ShinsaCommand[] {
  if (combined && chance(random, 0.5)) return listProgressCommands(state, random);
  const open = Object.values(state.tasks).filter((task) => !isTaskSettled(task)).length;
  const commands: ShinsaCommand[] = [
    ...(combined && open >= COMBINED_OPEN_TASKS
      ? []
      : [
          {
            type: 'task.create' as const,
            request: 'Look into the retry',
            repoId: 'repo',
            ...(chance(random, 0.5) ? { shape: pick(random, TASK_SHAPES) ?? 'investigate' } : {}),
          },
        ]),
    ...listAgentCommands(state, random, combined),
  ];
  for (const task of Object.values(state.tasks)) {
    if (task.stage === 'triage' && task.size === null) {
      commands.push({
        type: 'task.triage',
        taskId: task.id,
        title: `Task ${task.id}`,
        repoId: 'repo',
        size: 'small',
        branch: `b-${task.id}`,
        waitsOn: [],
        shape: pick(random, TASK_SHAPES) ?? 'change',
        priority: pick(random, ['urgent', 'normal', 'low'] as const) ?? 'normal',
        reasons: { shape: 'Read the request.' },
      });
    }
    const change = Object.values(state.gates).find(
      (gate) => gate.taskId === task.id && gate.type === 'proposal' && gate.status === 'open'
    );
    if (change && resolveTaskPipeline(task).includes('your_ok')) {
      commands.push({
        type: 'gate.answer',
        gateId: change.id,
        decision: chance(random, 0.7) ? 'approve' : 'reject',
        response: null,
      });
    }
    const operation = Object.values(state.gates).find(
      (gate) => gate.taskId === task.id && gate.type === 'operation' && gate.status === 'open'
    );
    if (operation) {
      commands.push({
        type: 'gate.answer',
        gateId: operation.id,
        decision: chance(random, 0.5)
          ? 'reject'
          : (pick(random, ['approve', 'answer'] as const) ?? 'approve'),
        response: 'Run it on the merged code.',
      });
    }
  }
  return commands;
}

function assertStageFitsPipeline(task: Task, pipeline: readonly PipelineStep[], context: string) {
  const step = resolveStageStep(task.stage);
  if (step) expect(pipeline, `${context}: the stage needs ${step}`).toContain(step);
}

function isConfirmed(gates: Gate[]) {
  return gates.some(
    (gate) =>
      gate.type === 'operation' &&
      gate.status === 'answered' &&
      (gate.decision === 'approve' || gate.decision === 'answer')
  );
}

function assertOperationInvariants(
  task: Task,
  pipeline: readonly PipelineStep[],
  gates: Gate[],
  history: Gate[],
  context: string
) {
  const timing = resolveOperationTiming(pipeline);
  if (task.stage === 'operating' && timing === 'after_merge') {
    expect(task.pullRequest?.state, `${context}: operating after the merge before it merged`).toBe('merged');
    expect(isConfirmed(history), `${context}: operating after the merge without your OK`).toBe(true);
  }
  const confirming = gates.filter((gate) => gate.type === 'operation' && gate.status === 'open');
  expect(confirming.length, `${context}: an operation gate exactly while it waits`).toBe(
    task.stage === 'awaiting_operation' ? 1 : 0
  );
  if (task.stage === 'awaiting_operation') {
    expect(timing, context).toBe('after_merge');
    expect(task.pullRequest?.state, `${context}: confirming an operation before the merge`).toBe('merged');
  }
  if (task.stage === 'operating' && timing === 'before_build') {
    expect(task.phaseReports, `${context}: operating after building started`).toHaveLength(0);
  }
  if (timing === 'after_merge')
    expect(task.stage, `${context}: merged before its operation`).not.toBe('merged');
  if (task.pullRequest?.state === 'merged' && !isTaskSettled(task)) {
    expect(
      ['operating', 'awaiting_operation'],
      `${context}: a merged pull request on an open task`
    ).toContain(task.stage);
  }
}

function isAllBuilt(task: Task) {
  const phases = task.plan?.document?.phases.length ?? 0;
  return phases > 0 && new Set(task.phaseReports.map((report) => report.index)).size >= phases;
}

export function assertShapeInvariants(task: Task, gates: Gate[], state: ShinsaState, context: string) {
  const pipeline = resolveTaskPipeline(task);
  expect(validatePipeline(pipeline), `${context}: pipeline ${pipeline.join(',')}`).toEqual([]);
  expect(validateVerification(pipeline), `${context}: verification of ${pipeline.join(',')}`).toEqual([]);
  if (task.plan?.document) {
    expect(validatePlanRules(pipeline, task.plan.document), `${context}: the plan breaks a rule`).toEqual([]);
  }
  if (isAllBuilt(task)) {
    const attached = Object.values(state.evidence).filter(
      (item) => item.taskId === task.id && isOfCurrentRound(task, item)
    );
    expect(
      listMissingEvidence(task.plan?.document ?? null, attached),
      `${context}: built without evidence`
    ).toEqual([]);
  }
  assertStageFitsPipeline(task, pipeline, context);
  const change = gates.filter((gate) => gate.type === 'proposal');
  expect(change.length, context).toBeLessThanOrEqual(1);
  if (!isTaskSettled(task)) {
    expect(change.length === 1, `${context}: a change gate exactly while awaiting a change`).toBe(
      task.stage === 'awaiting_proposal'
    );
    if (task.proposal?.status === 'open') expect(task.stage, context).toBe('awaiting_proposal');
  }
  const inquiry = resolveInquiryStep(pipeline);
  if (pipeline.includes('your_ok') && AFTER_YOUR_OK.has(task.stage)) {
    expect(task.proposal?.status, `${context}: past your OK without it`).toBe('accepted');
  }
  if (pipeline.includes('your_ok') && task.stage === 'awaiting_proposal' && inquiry) {
    expect(isInquiryDone(task, inquiry), `${context}: your OK before the inquiry ran`).toBe(true);
  }
  const history = Object.values(state.gates).filter((gate) => gate.taskId === task.id);
  assertOperationInvariants(task, pipeline, gates, history, context);
  if (!pipeline.includes('pull_request')) expect(task.pullRequest, context).toBeNull();
  if (!pipeline.includes('build')) expect(task.phaseReports, context).toHaveLength(0);
  if (resolveTaskRounds(task).length === 1 && !hadWorktreeStep(task)) {
    expect(task.worktreePath, `${context}: a worktree without a step that needs one`).toBeNull();
    expect(task.branch, context).toBeNull();
  }
}

function listCompositionMarks(task: Task) {
  const pipeline = resolveTaskPipeline(task);
  const operated = task.result?.step === 'operate';
  const built = task.phaseReports.length > 0;
  const timing = resolveOperationTiming(pipeline);
  return [
    operated && task.pullRequest?.state === 'merged' ? 'operation after merge' : null,
    operated && built && timing === 'before_build' ? 'operation before build' : null,
    timing === 'after_merge' && task.stageReason === 'merged without running the operation'
      ? 'operation skipped after merge'
      : null,
  ];
}

export function listShapeMarks(state: ShinsaState) {
  return Object.values(state.tasks).flatMap((task) => [
    task.proposal?.status === 'accepted' ? 'accepted change' : null,
    task.proposal?.status === 'declined' ? 'declined change' : null,
    task.result?.step === 'operate' ? 'finished operation' : null,
    task.result?.step === 'research' ? 'written report' : null,
    task.result?.step === 'investigate' ? 'reported findings' : null,
    task.shapeChanges?.some((change) => change.by === 'you') ? 'reshaped by you' : null,
    task.shapeChanges?.some((change) => change.by === 'agent') ? 'reshaped by an agent' : null,
    resolveTaskShape(task) === 'fix' && task.phaseReports.length > 0 ? 'built fix' : null,
    ...listCompositionMarks(task),
    task.shapeChanges?.some((change) => change.by === 'agent' && resolvePresetOf(change.to) === null)
      ? 'composed steps'
      : null,
    resolveTaskPipeline(task).includes('your_ok') && task.proposal?.status === 'accepted'
      ? 'your OK given'
      : null,
    task.shapeChanges?.some((change) => change.from.includes('your_ok') && change.by === 'you')
      ? 'composition vetoed'
      : null,
  ]);
}
