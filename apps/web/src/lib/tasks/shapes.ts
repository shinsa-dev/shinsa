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
  selectEarlierOpenRound,
  type Task,
  type TaskShape,
  type WorkStep,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { Option } from 'effect';

export const SHAPE_LABEL: Record<TaskShape, string> = {
  answer: 'Answer only',
  investigate: 'Investigation',
  research: 'Research',
  change: 'Change',
  fix: 'Find and fix',
  operation: 'Operation',
  lead: 'Initiative lead',
};

export const SHAPE_ICON: Record<TaskShape, IconName> = {
  answer: 'IconBubbleText',
  investigate: 'IconMagnifyingGlass',
  research: 'IconBook',
  change: 'IconHammer',
  fix: 'IconBug',
  operation: 'IconConsole',
  lead: 'IconAgents',
};

const STEP_LABEL: Record<PipelineStep, string> = {
  answer: 'answer',
  research: 'research',
  investigate: 'investigate',
  your_ok: 'your OK',
  plan: 'plan',
  operate: 'run the operation',
  lead: 'lead the initiative',
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

export type ChangeReply = 'makeChange' | 'planOperation' | 'keepAsIs' | 'closeProposal';

interface ChangeAction {
  label: string;
  reply: ChangeReply;
}

const GO_ON: Record<WorkStep, ChangeAction & { reply: 'makeChange' | 'planOperation'; note: string }> = {
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

const CLOSE: ChangeAction & { note: string } = {
  label: 'Close',
  reply: 'closeProposal',
  note: 'The agent recommends closing. Close ends the task here and changes nothing.',
};

export function selectReturningPullRequest(task: Task): Option.Option<number> {
  return selectEarlierOpenRound(task).pipe(
    Option.flatMapNullishOr((round) => round.pullRequest),
    Option.map((pullRequest) => pullRequest.number)
  );
}

export function resolveCloseLabel(task: Task) {
  return Option.isSome(selectReturningPullRequest(task)) ? 'Close this round' : 'Close';
}

function resolveClose(task: Task): ChangeAction & { note: string } {
  return Option.match(selectReturningPullRequest(task), {
    onNone: () => CLOSE,
    onSome: (number) => ({
      label: resolveCloseLabel(task),
      reply: CLOSE.reply,
      note: `The agent found nothing to change. Close ends this round and brings back the merge of #${number}.`,
    }),
  });
}

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
  const preset = Option.getOrNull(resolvePresetOf(pipeline));
  const inquiry = Option.getOrNull(resolveInquiryStep(pipeline));
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
  return Option.getOrUndefined(resolveInquiryStep(resolveTaskPipeline(task))) ?? 'investigate';
}

function isAddedByProposal(task: Task) {
  const at = task.proposal?.at;
  return (task.shapeChanges ?? []).some((change) => change.at === at && !change.from.includes('your_ok'));
}

interface ChangeGate {
  eyebrow: string;
  title: string;
  why: string;
  request: string;
  requestLabel: string;
  primary: ChangeAction & { note: string };
  quiet: ChangeAction;
}

function resolveRequestLabel(close: boolean, composed: boolean) {
  if (close) return 'If you go on';
  return composed ? 'What comes next' : 'What it would change';
}

export function describeChangeGate(task: Task, gate: Gate): ChangeGate {
  const step = resolveChangeStep(task);
  const pipeline = resolveTaskPipeline(task);
  const open = task.proposal?.status === 'open' ? task.proposal : null;
  const close = open?.recommend === 'close';
  const composed = close || (pipeline.includes('your_ok') && !isAddedByProposal(task));
  const goOn = GO_ON[Option.getOrUndefined(resolveWorkStep(pipeline)) ?? 'build'];
  const [why = '', ...rest] = gate.body.split('\n\n');
  return {
    eyebrow: composed ? RESULT_IN[step] : CHANGE_EYEBROW[step],
    title: gate.title,
    why: open?.why ?? why,
    request: open?.request ?? rest.join('\n\n'),
    requestLabel: resolveRequestLabel(close, composed),
    primary: close ? resolveClose(task) : goOn,
    quiet: close ? { label: goOn.label, reply: goOn.reply } : { label: KEEP_LABEL[step], reply: 'keepAsIs' },
  };
}

const OPERATION_HEADING = {
  before_build: 'First, the operation',
  post_merge: 'After the merge, the operation',
} as const;

export function resolvePlannedOperation(task: Task) {
  const timing = Option.getOrNull(resolveOperationTiming(resolveTaskPipeline(task)));
  const steps = task.plan?.document?.operation ?? [];
  if (timing === null || timing === 'alone' || steps.length === 0) return null;
  return { heading: OPERATION_HEADING[timing], steps };
}
