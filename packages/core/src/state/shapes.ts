import { describeList } from '../chat/text.ts';
import {
  type DeliveringStep,
  type InquiryStep,
  isSamePipeline,
  listComposedSteps,
  needsWorktree,
  type PipelineStep,
  resolveInquiryStep,
  resolvePresetOf,
  resolveShapeOf,
  resolveTaskPipeline,
  resolveWorkStep,
  type ShapeActor,
  STEP_SCHEMA,
  type TaskShape,
  type WorkStep,
} from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

const SHAPE_CHANGE_LIMIT = 20;

const SHAPE_PHRASE: Record<TaskShape, string> = {
  answer: 'a question to answer',
  investigate: 'an investigation',
  research: 'research for a report',
  change: 'a change',
  fix: 'a find-and-fix change',
  operation: 'an operation',
};

const INQUIRY_PHRASE: Record<InquiryStep, string> = {
  answer: 'a question to answer',
  research: 'research',
  investigate: 'an investigation',
};

const WORK_PHRASE: Record<WorkStep, string> = {
  build: 'a change',
  operate: 'an operation',
};

const DELIVERY_TEXT: Record<DeliveringStep, string> = {
  answer: 'Answered the question',
  investigate: 'Reported the diagnosis',
  research: 'Wrote the report',
  operate: 'Reported how the operation went',
};

export function describeShape(shape: TaskShape) {
  return SHAPE_PHRASE[shape];
}

function describePipeline(steps: readonly PipelineStep[]) {
  const preset = resolvePresetOf(steps);
  const inquiry = resolveInquiryStep(steps);
  const work = steps.filter((step): step is WorkStep => step === 'build' || step === 'operate');
  if (preset || work.length === 0 || (!inquiry && work.length === 1)) {
    return SHAPE_PHRASE[preset ?? resolveShapeOf(steps)];
  }
  return [...(inquiry ? [INQUIRY_PHRASE[inquiry]] : []), ...work.map((step) => WORK_PHRASE[step])].join(
    ', then '
  );
}

function describeSteps(verb: string, steps: readonly PipelineStep[]) {
  const titles = steps.map((step) => STEP_SCHEMA[step].title);
  return `${verb} ${titles.length === 1 ? 'the step' : 'the steps'} ${describeList(titles)}`;
}

function describeHandOverChange(from: readonly PipelineStep[], to: readonly PipelineStep[]) {
  const added = to.filter((step) => !from.includes(step));
  const removed = from.filter((step) => !to.includes(step));
  return [
    ...(added.length > 0 ? [describeSteps('Added', added)] : []),
    ...(removed.length > 0 ? [describeSteps(added.length > 0 ? 'removed' : 'Removed', removed)] : []),
  ].join(' and ');
}

function describeReshape(steps: readonly PipelineStep[], by: ShapeActor) {
  if (by === 'you') return `Made it ${describePipeline(steps)}`;
  return `Turned into ${describePipeline(steps)}`;
}

function applyReshaped(state: ShinsaState, event: EventOf<'task.reshaped'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const from = [...resolveTaskPipeline(task)];
  const change = { from, to: event.pipeline, by: event.by, reason: event.reason, at: event.at };
  const branch = task.branch ?? (needsWorktree(event.pipeline) ? (task.proposedBranch ?? null) : null);
  updateTask(state, task.id, event.at, {
    pipeline: event.pipeline,
    shapeChanges: [...(task.shapeChanges ?? []), change].slice(-SHAPE_CHANGE_LIMIT),
    branch,
    ...(event.by === 'you' ? { auto: { ...task.auto, shape: false } } : {}),
  });
  record(state, task.id, event.at, {
    actor: event.by,
    kind: 'shape',
    text: isSamePipeline(listComposedSteps(from), listComposedSteps(event.pipeline))
      ? describeHandOverChange(from, event.pipeline)
      : describeReshape(event.pipeline, event.by),
    detail: event.reason || null,
  });
}

function applyDelivered(state: ShinsaState, event: EventOf<'task.delivered'>) {
  updateTask(state, event.taskId, event.at, {
    result: { step: event.step, body: event.body, runId: event.runId, at: event.at },
  });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'answer',
    text: DELIVERY_TEXT[event.step],
    runId: event.runId,
  });
}

function applyChangeProposed(state: ShinsaState, event: EventOf<'task.change_proposed'>) {
  const task = state.tasks[event.taskId];
  const isOperation = task !== undefined && resolveWorkStep(resolveTaskPipeline(task)) === 'operate';
  updateTask(state, event.taskId, event.at, {
    proposal: { request: event.request, why: event.why, status: 'open', runId: event.runId, at: event.at },
  });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'shape',
    text: isOperation ? 'Proposed running an operation' : 'Proposed turning this into a change',
    detail: event.why,
    runId: event.runId,
  });
}

function applyChangeDeclined(state: ShinsaState, event: EventOf<'task.change_declined'>) {
  const proposal = state.tasks[event.taskId]?.proposal;
  if (!proposal) return;
  updateTask(state, event.taskId, event.at, { proposal: { ...proposal, status: 'declined' } });
}

function applyChangeApproved(state: ShinsaState, event: EventOf<'task.change_approved'>) {
  const proposal = state.tasks[event.taskId]?.proposal;
  if (!proposal) return;
  updateTask(state, event.taskId, event.at, { proposal: { ...proposal, status: 'accepted' } });
}

type ShapeEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'task.reshaped'
      | 'task.delivered'
      | 'task.change_proposed'
      | 'task.change_declined'
      | 'task.change_approved';
  }
>;

export function applyShapeEvent(state: ShinsaState, event: ShapeEvent) {
  switch (event.type) {
    case 'task.reshaped':
      applyReshaped(state, event);
      return;
    case 'task.delivered':
      applyDelivered(state, event);
      return;
    case 'task.change_proposed':
      applyChangeProposed(state, event);
      return;
    case 'task.change_declined':
      applyChangeDeclined(state, event);
      return;
    case 'task.change_approved':
      applyChangeApproved(state, event);
      return;
  }
}
