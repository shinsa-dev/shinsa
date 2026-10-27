import type { ChangeProposalInput, CommandOf } from '../commands/index.ts';
import {
  DomainError,
  findInquiryStep,
  findWorkStep,
  type Gate,
  type GateDecision,
  hasStep,
  type InquiryStep,
  isComposedByAgent,
  isFollowUpOnWork,
  isInquiryDone,
  isLaterRound,
  isSamePipeline,
  isWorktreeStep,
  listComposedSteps,
  type PipelineStep,
  type Run,
  resolveInquiryStep,
  resolveOperationTiming,
  resolveProposalUpgrade,
  resolveTaskPipeline,
  resolveTaskRounds,
  resolveWorkStep,
  SHAPE_PIPELINES,
  type ShapeActor,
  type Task,
  type TaskStage,
  validateComposition,
  validatePipeline,
  type WorkStep,
} from '../domain/index.ts';
import {
  resolveAgentPrompt,
  resolveAnswererPrompt,
  resolveFollowUpPrompt,
  resolveInvestigatorPrompt,
  resolveOperationInstruction,
  resolveResearcherPrompt,
} from '../prompts/index.ts';
import { listOpenGates } from '../state/queries.ts';
import { assertEvidence } from './agents.ts';
import type { Decider } from './decider.ts';
import { settleTask, startPhase, startPlanning, startWork } from './lifecycle.ts';
import { findCurrentRun } from './runs.ts';
import { requestWorkspace } from './workspaces.ts';

const INQUIRY_STAGE: Record<InquiryStep, TaskStage> = {
  answer: 'answering',
  research: 'researching',
  investigate: 'investigating',
};

const INQUIRY_REASON: Record<InquiryStep, string> = {
  answer: 'answering your question',
  research: 'researching',
  investigate: 'investigating',
};

const SETTLED_REASON: Record<InquiryStep, string> = {
  answer: 'answered your question',
  research: 'wrote the report',
  investigate: 'reported its diagnosis',
};

const DECLINED_REASON: Record<InquiryStep, string> = {
  answer: 'kept as an answer',
  research: 'kept as a report',
  investigate: 'kept as an investigation',
};

const LOCKED_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'building',
  'checking',
  'reviewing',
  'fixing',
  'awaiting_review',
  'shipping',
  'awaiting_merge',
  'operating',
  'awaiting_operation',
]);

const CHANGE_PROPOSAL_TITLE: Record<InquiryStep, string> = {
  answer: 'Turn this answer into a change?',
  research: 'Turn this report into a change?',
  investigate: 'Turn this investigation into a fix?',
};

const OPERATION_PROPOSAL_TITLE: Record<InquiryStep, string> = {
  answer: 'Run an operation from this answer?',
  research: 'Run an operation from this report?',
  investigate: 'Run an operation from this diagnosis?',
};

const NEXT_WORK: Record<WorkStep, string> = {
  build: 'Plan the change and build it. You review it before a pull request opens.',
  operate: 'Plan the operation. You approve the plan before anything runs.',
};

function assertPipeline(steps: PipelineStep[]) {
  const errors = validatePipeline(steps);
  if (errors.length > 0) throw new DomainError('pipeline_invalid', errors.join(' '));
}

function reshapeTask(
  decider: Decider,
  taskId: string,
  pipeline: PipelineStep[],
  by: ShapeActor,
  reason: string
) {
  assertPipeline(pipeline);
  decider.emit({ type: 'task.reshaped', taskId, pipeline, by, reason });
}

type EntryStep = InquiryStep | 'your_ok' | 'plan' | null;

function hasYourOk(task: Task) {
  return task.proposal?.status === 'accepted';
}

export function resolveNextStep(task: Task): EntryStep {
  const pipeline = resolveTaskPipeline(task);
  const inquiry = resolveInquiryStep(pipeline);
  if (inquiry && !isInquiryDone(task, inquiry)) return inquiry;
  if (pipeline.includes('your_ok') && !hasYourOk(task)) return 'your_ok';
  return pipeline.includes('plan') ? 'plan' : null;
}

export function startInquiry(decider: Decider, taskId: string, step: InquiryStep, followUp: string | null) {
  decider.stage(taskId, INQUIRY_STAGE[step], followUp ? 'answering your follow-up' : INQUIRY_REASON[step]);
  const task = decider.task(taskId);
  const repo = decider.repoOf(task);
  if (step === 'answer') {
    decider.startRun(task, 'answerer', resolveAnswererPrompt(task, repo, followUp), {
      resumeFrom: decider.taskSession(taskId, 'answerer'),
    });
    return;
  }
  if (step === 'research') {
    decider.startRun(task, 'researcher', resolveResearcherPrompt(task, repo, followUp), {
      resumeFrom: decider.taskSession(taskId, 'researcher'),
    });
    return;
  }
  decider.startRun(task, 'investigator', resolveInvestigatorPrompt(task, repo, followUp), {
    resumeFrom: decider.taskSession(taskId, 'investigator'),
  });
}

export function startOperation(decider: Decider, taskId: string, guidance: string | null) {
  decider.stage(taskId, 'operating', 'running the operation');
  const task = decider.task(taskId);
  decider.startRun(task, 'agent', resolveAgentPrompt(resolveOperationInstruction(task, guidance)), {
    purpose: 'operate',
    resumeFrom: decider.taskSession(taskId, 'agent'),
  });
}

export function startAfterPlan(decider: Decider, taskId: string) {
  if (resolveWorkStep(resolveTaskPipeline(decider.task(taskId))) === 'operate') {
    startOperation(decider, taskId, null);
    return;
  }
  startPhase(decider, taskId, 0);
}

export function finishMerge(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (resolveOperationTiming(resolveTaskPipeline(task)) !== 'post_merge') {
    settleTask(decider, taskId, 'merged', 'pull request merged');
    return;
  }
  decider.cancelRuns(taskId);
  decider.cancelEffects(
    taskId,
    ['pull_request.open', 'pull_request.push', 'pull_request.watch', 'pull_request.merge', 'checks.run'],
    'The pull request merged.'
  );
  decider.withdrawGates(taskId, (gate) => gate.type !== 'post_merge');
  decider.clearWaits(taskId);
  openOperationGate(decider, decider.task(taskId));
}

function describeMergedCommit(task: Task) {
  const commit = task.pullRequest?.mergeCommit ?? null;
  const number = task.pullRequest?.number;
  const merged = number ? `Pull request #${number} merged` : 'The change merged';
  return commit ? `${merged} as \`${commit.slice(0, 7)}\`.` : `${merged}.`;
}

function describeOperationGate(task: Task) {
  const document = task.plan?.document ?? null;
  const steps = (document?.operation ?? []).map((step, index) => `${index + 1}. ${step}`);
  return [
    `${describeMergedCommit(task)} The merged code can differ from the plan you approved, so check it before the operation runs.`,
    steps.length > 0 ? ['', '## Operation', ...steps].join('\n') : '',
    document?.impact ? ['', '## Impact', document.impact].join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function openOperationGate(decider: Decider, task: Task) {
  decider.stage(task.id, 'awaiting_operation', 'waiting for your OK to run the operation');
  decider.openGate(
    task.id,
    'operation',
    'The change merged. Run the operation now?',
    describeOperationGate(task),
    { details: { commit: task.pullRequest?.mergeCommit ?? null, notes: null } }
  );
}

function replaceNotes(decider: Decider, gate: Gate, text: string) {
  const notes = text.trim() || null;
  if (notes === (gate.notes ?? null)) return notes;
  decider.emit({ type: 'gate.noted', gateId: gate.id, notes });
  return notes;
}

export function noteOperation(decider: Decider, taskId: string, text: string) {
  for (const gate of listOpenGates(decider.state, taskId)) {
    if (gate.type === 'operation') replaceNotes(decider, gate, text);
  }
}

export function answerOperation(
  decider: Decider,
  gate: Gate,
  decision: GateDecision,
  response: string | null
) {
  if (decision === 'reject') {
    settleTask(decider, gate.taskId, 'done', 'merged without running the operation');
    return;
  }
  const notes = decision === 'reply' ? replaceNotes(decider, gate, response ?? '') : (gate.notes ?? null);
  startOperation(decider, gate.taskId, notes);
}

export function startStep(decider: Decider, taskId: string, step: EntryStep) {
  if (step === null) {
    settleTask(decider, taskId, 'done', 'finished every step');
    return;
  }
  if (step === 'plan') {
    startPlanning(decider, taskId, null);
    return;
  }
  if (step === 'your_ok') {
    requestYourOk(decider, taskId, null, null);
    return;
  }
  startInquiry(decider, taskId, step, null);
}

export function proceedAfterSetup(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const step = resolveNextStep(task);
  if (step !== null && isWorktreeStep(step)) {
    requestWorkspace(decider, taskId);
    return;
  }
  startStep(decider, taskId, step);
}

function openProposalGate(decider: Decider, task: Task, step: InquiryStep, proposal: ChangeProposalInput) {
  const operation = resolveWorkStep(resolveTaskPipeline(task)) === 'operate';
  decider.stage(task.id, 'awaiting_proposal', 'a proposal waits for your OK');
  decider.openGate(
    task.id,
    'proposal',
    operation ? OPERATION_PROPOSAL_TITLE[step] : CHANGE_PROPOSAL_TITLE[step],
    `${proposal.why}\n\n${proposal.request}`
  );
}

function resolveComposedReason(task: Task) {
  const change = [...(task.shapeChanges ?? [])].reverse().find((entry) => entry.by === 'agent');
  return change?.reason || 'The work goes on only with your OK.';
}

function requestYourOk(
  decider: Decider,
  taskId: string,
  runId: string | null,
  proposal: ChangeProposalInput | null
) {
  const task = decider.task(taskId);
  const pipeline = resolveTaskPipeline(task);
  const step = findInquiryStep(pipeline);
  const next = proposal ?? {
    request: NEXT_WORK[findWorkStep(pipeline)],
    why: resolveComposedReason(task),
  };
  decider.emit({ type: 'task.change_proposed', taskId, request: next.request, why: next.why, runId });
  openProposalGate(decider, decider.task(taskId), step, next);
}

function finishInquiry(
  decider: Decider,
  taskId: string,
  step: InquiryStep,
  runId: string,
  proposal: ChangeProposalInput | null
) {
  const task = decider.task(taskId);
  const pipeline = resolveTaskPipeline(task);
  if (pipeline.includes('your_ok')) {
    requestYourOk(decider, taskId, runId, proposal);
    return;
  }
  if (pipeline.includes('plan')) {
    requestWorkspace(decider, taskId);
    return;
  }
  if (proposal) {
    reshapeTask(decider, taskId, resolveProposalUpgrade(pipeline), 'agent', proposal.why);
    requestYourOk(decider, taskId, runId, proposal);
    return;
  }
  settleTask(decider, taskId, 'done', SETTLED_REASON[step]);
}

const DELIVER_TOOL = {
  answer: 'answer',
  investigate: 'report_diagnosis',
  research: 'submit_report',
  operate: 'report_outcome',
} as const;

export function recordDelivery(decider: Decider, command: CommandOf<'agent.deliver'>) {
  const { run, task } = findCurrentRun(decider, command.runId, DELIVER_TOOL[command.step]);
  if (isFollowUpOnWork(task)) {
    finishFollowUp(decider, task, run, command.proposal ?? null);
    return;
  }
  if (command.step === 'operate' && !hasStep(task, 'build'))
    assertEvidence(decider, task, 'report the outcome');
  decider.emit({
    type: 'task.delivered',
    taskId: task.id,
    step: command.step,
    body: command.body,
    runId: run.id,
  });
  decider.endRun(run, 'completed', command.step === 'answer' ? 'Answered the question.' : null);
  decider.progressed(task.id);
  if (command.step === 'operate') {
    finishOperation(decider, task.id);
    return;
  }
  finishInquiry(decider, task.id, command.step, run.id, command.proposal ?? null);
}

function finishOperation(decider: Decider, taskId: string) {
  if (resolveOperationTiming(resolveTaskPipeline(decider.task(taskId))) === 'before_build') {
    startPhase(decider, taskId, 0);
    return;
  }
  settleTask(decider, taskId, 'done', 'the operation finished');
}

function resolveComposition(command: CommandOf<'agent.reshape'>): PipelineStep[] {
  if ('steps' in command) return [...command.steps];
  return [...SHAPE_PIPELINES[command.shape]];
}

export function recordReshape(decider: Decider, command: CommandOf<'agent.reshape'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'reshape_task');
  if (!task.auto.shape) {
    throw new DomainError(
      'shape_chosen',
      'The kind of this task was set when it was created. Plan it, or ask the human with `ask` if it should be something else.'
    );
  }
  if (task.plan !== null || isShapeLocked(task)) {
    throw new DomainError('plan_exists', 'This task already has a plan. Revise the plan instead.');
  }
  if (isComposedByAgent(task)) {
    throw new DomainError(
      'steps_set',
      'The steps of this task are already set. Plan them with `propose_plan`.'
    );
  }
  const pipeline = resolveComposition(command);
  assertShipsOntoOpenPullRequest(task, pipeline);
  const errors = validateComposition(task, pipeline);
  if (errors.length > 0) throw new DomainError('pipeline_invalid', errors.join(' '));
  const before = resolveTaskPipeline(task);
  if (isSamePipeline(listComposedSteps(before), pipeline)) return;
  decider.endRun(run, 'completed', command.reason);
  reshapeTask(decider, task.id, pipeline, 'agent', command.reason);
  const work = resolveWorkStep(pipeline);
  if (work !== null && work !== resolveWorkStep(before)) {
    startWork(decider, task.id);
    return;
  }
  startStep(decider, task.id, resolveNextStep(decider.task(task.id)));
}

export function isShapeLocked(task: Task) {
  return (
    LOCKED_STAGES.has(task.stage) ||
    task.phaseReports.length > 0 ||
    (task.pullRequest !== null && !isLaterRound(task)) ||
    task.result?.step === 'operate'
  );
}

function hasOpenPullRequest(task: Task) {
  return (
    task.pullRequest?.state === 'open' ||
    resolveTaskRounds(task).some((round) => round.status === 'shipped' && round.pullRequest?.state === 'open')
  );
}

function assertShipsOntoOpenPullRequest(task: Task, pipeline: PipelineStep[]) {
  if (!hasOpenPullRequest(task)) return;
  if (!pipeline.includes('pull_request')) {
    throw new DomainError(
      'pull_request_open',
      'An earlier round of this task has an open pull request, so this round ships through one too: keep `build`, `pull_request` and `merge` in the steps.'
    );
  }
  if (pipeline.includes('your_ok')) {
    throw new DomainError(
      'pull_request_open',
      "An earlier round of this task has an open pull request, so this round cannot wait for the human's OK before it plans: drop `your_ok` and the inquiry step before it, and plan the change."
    );
  }
}

export function answerProposal(decider: Decider, gate: Gate, decision: GateDecision) {
  const task = decider.task(gate.taskId);
  const step = findInquiryStep(resolveTaskPipeline(task));
  if (decision === 'reject') {
    decider.emit({ type: 'task.change_declined', taskId: task.id });
    reshapeTask(decider, task.id, [step], 'you', DECLINED_REASON[step]);
    settleTask(decider, task.id, 'done', DECLINED_REASON[step]);
    return;
  }
  decider.emit({ type: 'task.change_approved', taskId: task.id });
  startWork(decider, task.id);
}

export function followUpInquiry(decider: Decider, taskId: string, text: string) {
  const task = decider.task(taskId);
  const step = findInquiryStep(resolveTaskPipeline(task));
  decider.withdrawGates(taskId, (gate) => gate.type === 'proposal');
  if (task.proposal?.status === 'open') decider.emit({ type: 'task.change_declined', taskId });
  startInquiry(decider, taskId, step, text);
}

export function answerFollowUp(decider: Decider, taskId: string, question: string | null) {
  decider.stage(taskId, 'answering', 'answering your follow-up');
  const task = decider.task(taskId);
  decider.startRun(task, 'answerer', resolveFollowUpPrompt(task, decider.repoOf(task), question), {
    resumeFrom: decider.taskSession(taskId, 'answerer'),
  });
}

export function restartAnswer(decider: Decider, task: Task, text: string | null) {
  if (isFollowUpOnWork(task)) {
    answerFollowUp(decider, task.id, text);
    return;
  }
  startInquiry(decider, task.id, 'answer', text);
}

function resolveRestingStage(task: Task) {
  const merged = task.pullRequest?.state === 'merged';
  return merged && resolveOperationTiming(resolveTaskPipeline(task)) !== 'post_merge' ? 'merged' : 'done';
}

function finishFollowUp(decider: Decider, task: Task, run: Run, proposal: ChangeProposalInput | null) {
  if (proposal) {
    throw new DomainError(
      'follow_up_proposal',
      'This answers a follow-up on finished work, so it proposes no change. Call `answer` without `propose_change`; work worth doing outside this task goes to `suggest_tasks`.'
    );
  }
  decider.endRun(run, 'completed', 'Answered your follow-up.');
  decider.progressed(task.id);
  settleTask(decider, task.id, resolveRestingStage(task), 'answered your follow-up');
}

export function acceptsFollowUp(task: Task) {
  const pipeline = resolveTaskPipeline(task);
  return task.stage === 'done' && !pipeline.includes('plan') && resolveInquiryStep(pipeline) !== null;
}
