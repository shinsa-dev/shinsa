import {
  capitalise,
  type DeliveringStep,
  type Gate,
  hasStep,
  type InquiryStep,
  lowerFirst,
  type PipelineStep,
  resolveInquiryStep,
  resolveOperationTiming,
  resolvePresetOf,
  resolveShapeOf,
  resolveShapeState,
  resolveTaskPipeline,
  resolveTaskProgress,
  resolveTaskShape,
  resolveWorkStep,
  type Task,
  type TaskShape,
  type WorkStep,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';

export const SHAPE_LABEL: Record<TaskShape, string> = {
  answer: 'Answer only',
  investigate: 'Investigation',
  research: 'Research',
  change: 'Change',
  fix: 'Find and fix',
  operation: 'Operation',
};

const SHAPE_ICON: Record<TaskShape, IconName> = {
  answer: 'IconBubbleText',
  investigate: 'IconMagnifyingGlass',
  research: 'IconBook',
  change: 'IconHammer',
  fix: 'IconBug',
  operation: 'IconConsole',
};

const STEP_LABEL: Record<PipelineStep, string> = {
  answer: 'answer',
  research: 'research',
  investigate: 'investigate',
  your_ok: 'your OK',
  plan: 'plan',
  operate: 'run the operation',
  build: 'build',
  checks: 'checks',
  agent_review: 'agent review',
  your_review: 'your review',
  pull_request: 'pull request',
  pre_merge: 'pre-merge',
  merge: 'merge',
  post_merge: 'post-merge',
};

export const RESULT_PANEL: Record<DeliveringStep, { title: string; icon: IconName }> = {
  answer: { title: 'Answer', icon: 'IconBubbleText' },
  investigate: { title: 'Diagnosis', icon: 'IconMagnifyingGlass' },
  research: { title: 'Report', icon: 'IconBook' },
  operate: { title: 'Outcome', icon: 'IconConsole' },
};

const CHANGE_EYEBROW: Record<InquiryStep, string> = {
  answer: 'The answer proposes a change',
  research: 'The report proposes a change',
  investigate: 'The investigation proposes a fix',
};

const INQUIRY_LEAD: Record<InquiryStep, string> = {
  answer: 'Answer',
  research: 'Research',
  investigate: 'Investigation',
};

const WORK_NOUN: Record<WorkStep, string> = {
  build: 'change',
  operate: 'operation',
};

const RESULT_IN: Record<InquiryStep, string> = {
  answer: 'The answer is in',
  research: 'The report is in',
  investigate: 'The diagnosis is in',
};

const GO_ON: Record<WorkStep, { label: string; reply: 'makeChange' | 'planOperation'; note: string }> = {
  build: {
    label: 'Make it a change',
    reply: 'makeChange',
    note: 'A change gets a plan, then your review before it merges.',
  },
  operate: {
    label: 'Plan the operation',
    reply: 'planOperation',
    note: 'An operation gets a plan you approve before anything runs.',
  },
};

const KEEP_LABEL: Record<InquiryStep, string> = {
  answer: 'Keep it as an answer',
  research: 'Keep it as a report',
  investigate: 'Keep it as an investigation',
};

function isWorkStep(step: PipelineStep): step is WorkStep {
  return step in WORK_NOUN;
}

const UNCHOSEN = {
  label: 'Kind not chosen yet',
  icon: 'IconCircleDotted',
  steps: 'Shinsa is reading the request to choose what kind of task it is.',
} as const;

export function isShapeChosen(task: Task) {
  return resolveShapeState(task) !== 'triage';
}

export function resolveShapeLabel(task: Task) {
  if (!isShapeChosen(task)) return UNCHOSEN.label;
  const pipeline = resolveTaskPipeline(task);
  const preset = resolvePresetOf(pipeline);
  const inquiry = resolveInquiryStep(pipeline);
  const parts = [
    ...(inquiry ? [INQUIRY_LEAD[inquiry]] : []),
    ...pipeline.filter(isWorkStep).map((step) => WORK_NOUN[step]),
  ];
  if (preset || parts.length < 2) return SHAPE_LABEL[preset ?? resolveShapeOf(pipeline)];
  return capitalise(parts.join(', then '));
}

export function resolveShapeIcon(task: Task): IconName {
  if (!isShapeChosen(task)) return UNCHOSEN.icon;
  return SHAPE_ICON[resolveTaskShape(task)];
}

function listStepTitles(task: Task) {
  const titles = resolveTaskProgress(task).phases.map((phase) => (phase.planned ? 'Build' : phase.title));
  return titles.filter((title, index) => title !== titles[index - 1]).map(lowerFirst);
}

export function describeTaskSteps(task: Task) {
  if (!isShapeChosen(task)) return UNCHOSEN.steps;
  const steps = listStepTitles(task);
  const last = steps.pop() ?? '';
  const list = steps.length > 0 ? `${steps.join(', ')}, then ${last}` : last;
  return `${resolveShapeLabel(task)}: ${list}.`;
}

export function describeSteps(steps: readonly string[]) {
  return steps
    .filter((step): step is PipelineStep => step in STEP_LABEL)
    .map((step) => STEP_LABEL[step])
    .join(', ');
}

export function isCodeTask(task: Task) {
  return hasStep(task, 'build');
}

function resolveChangeStep(task: Task) {
  return resolveInquiryStep(resolveTaskPipeline(task)) ?? 'investigate';
}

function isAddedByProposal(task: Task) {
  const at = task.proposal?.at;
  return (task.shapeChanges ?? []).some((change) => change.at === at && !change.from.includes('your_ok'));
}

export function describeChangeGate(task: Task, gate: Gate) {
  const step = resolveChangeStep(task);
  const pipeline = resolveTaskPipeline(task);
  const composed = pipeline.includes('your_ok') && !isAddedByProposal(task);
  const open = task.proposal?.status === 'open' ? task.proposal : null;
  const [why = '', ...rest] = gate.body.split('\n\n');
  return {
    eyebrow: composed ? RESULT_IN[step] : CHANGE_EYEBROW[step],
    keep: KEEP_LABEL[step],
    why: open?.why ?? why,
    request: open?.request ?? rest.join('\n\n'),
    requestLabel: composed ? 'What comes next' : 'What it would change',
    goOn: GO_ON[resolveWorkStep(pipeline) ?? 'build'],
  };
}

const OPERATION_HEADING = {
  before_build: 'First, the operation',
  post_merge: 'After the merge, the operation',
} as const;

export function resolvePlannedOperation(task: Task) {
  const timing = resolveOperationTiming(resolveTaskPipeline(task));
  const steps = task.plan?.document?.operation ?? [];
  if (timing === null || timing === 'alone' || steps.length === 0) return null;
  return { heading: OPERATION_HEADING[timing], steps };
}
