import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  type Gate,
  isAgentQuestion,
  isTaskClosed,
  isTaskResting,
  isTaskSettled,
  type MessageKind,
  type Run,
  resolveNextRoundNumber,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import { resolveHumanFixPrompt } from '../prompts/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates, listRunningRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { queueMessageForWake } from './delegations.ts';
import { startFix } from './fixes.ts';
import { answerGate } from './gates.ts';
import { resolveCurrentPhase, startPhase, startPlanning } from './lifecycle.ts';
import { queueRound } from './rounds.ts';
import {
  acceptsFollowUp,
  answerFollowUp,
  followUpInquiry,
  noteOperation,
  restartAnswer,
  startInquiry,
  startOperation,
} from './shapes.ts';
import { hasRoomForSuggestion, suggestSplitOff } from './suggestions.ts';

type StageEffect =
  | 'kept'
  | 'revise_plan'
  | 'restart_step'
  | 'decline_proposal'
  | 'operation_notes'
  | 'request_changes'
  | 'send_back'
  | 'fix';

export type MessageEffect =
  | StageEffect
  | 'closed'
  | 'follow_up'
  | 'steer'
  | 'wake'
  | 'retry'
  | 'verify_setup'
  | 'supersede_question';

type Delivery =
  | { effect: 'steer' | 'wake'; run: Run }
  | { effect: 'retry' | 'verify_setup' | 'supersede_question'; gate: Gate }
  | { effect: StageEffect | 'follow_up' };

const STAGE_EFFECT: Record<TaskStage, StageEffect> = {
  triage: 'kept',
  waiting_on_tasks: 'kept',
  planning: 'revise_plan',
  awaiting_plan: 'revise_plan',
  building: 'restart_step',
  answering: 'restart_step',
  researching: 'restart_step',
  investigating: 'restart_step',
  operating: 'restart_step',
  awaiting_proposal: 'decline_proposal',
  awaiting_operation: 'operation_notes',
  checking: 'fix',
  reviewing: 'fix',
  fixing: 'fix',
  shipping: 'fix',
  awaiting_review: 'request_changes',
  awaiting_merge: 'send_back',
  merged: 'fix',
  done: 'fix',
  cancelled: 'fix',
};

function isRetriedByMessage(gate: Gate) {
  return gate.type === 'failure' || gate.type === 'sign_in';
}

function resolveDelivery(state: ShinsaState, task: Task): Delivery {
  const gates = listOpenGates(state, task.id);
  const paused = gates.find(isRetriedByMessage);
  if (paused) return { effect: 'retry', gate: paused };
  const setup = gates.find((gate) => gate.type === 'configuration');
  if (setup) return { effect: 'verify_setup', gate: setup };
  const question = gates.find(isAgentQuestion);
  if (question) return { effect: 'supersede_question', gate: question };
  const waiting = listRunningRuns(state, task.id).find((run) => run.status === 'waiting');
  if (waiting) return { effect: 'wake', run: waiting };
  return { effect: STAGE_EFFECT[task.stage] };
}

type MessageDelivery = Delivery | { effect: 'closed' };

function resolveMessageDelivery(state: ShinsaState, task: Task): MessageDelivery {
  if (isTaskClosed(task)) return { effect: 'closed' };
  if (isTaskResting(task)) return { effect: 'follow_up' };
  const [running] = listRunningRuns(state, task.id);
  if (running?.status === 'waiting') return { effect: 'wake', run: running };
  if (running && listOpenGates(state, task.id).length === 0) return { effect: 'steer', run: running };
  return resolveDelivery(state, task);
}

export function resolveMessageEffect(state: ShinsaState, task: Task): MessageEffect {
  return resolveMessageDelivery(state, task).effect;
}

export function needsMessageKind(state: ShinsaState, task: Task) {
  return resolveMessageEffect(state, task) !== 'closed';
}

function restartStep(decider: Decider, task: Task, text: string) {
  switch (task.stage) {
    case 'answering':
      restartAnswer(decider, task, text);
      return;
    case 'researching':
      startInquiry(decider, task.id, 'research', text);
      return;
    case 'investigating':
      startInquiry(decider, task.id, 'investigate', text);
      return;
    case 'operating':
      startOperation(decider, task.id, text);
      return;
    default:
      startPhase(
        decider,
        task.id,
        resolveCurrentPhase(task),
        decider.lastRun(task.id, ['builder']),
        `\n\nThe human added: ${text}`
      );
  }
}

function deliverMessage(decider: Decider, task: Task, delivery: Delivery, text: string) {
  switch (delivery.effect) {
    case 'kept':
      return;
    case 'steer':
      decider.run({ kind: 'run.steer', runId: delivery.run.id, text });
      return;
    case 'wake':
      queueMessageForWake(decider, delivery.run, text);
      return;
    case 'retry':
      answerGate(decider, delivery.gate.id, 'reply', text);
      return;
    case 'verify_setup':
      answerGate(decider, delivery.gate.id, 'approve', null);
      return;
    case 'supersede_question':
      decider.emit({ type: 'gate.superseded', gateId: delivery.gate.id, text });
      decider.run({ kind: 'question.resolve', gateId: delivery.gate.id });
      return;
    case 'follow_up':
      if (acceptsFollowUp(task)) followUpInquiry(decider, task.id, text);
      else answerFollowUp(decider, task.id, text);
      return;
    case 'decline_proposal':
      followUpInquiry(decider, task.id, text);
      return;
    case 'revise_plan':
      decider.withdrawGates(task.id, (gate) => gate.type === 'plan');
      startPlanning(decider, task.id, text);
      return;
    case 'restart_step':
      restartStep(decider, task, text);
      return;
    case 'operation_notes':
      noteOperation(decider, task.id, text);
      return;
    case 'request_changes':
    case 'send_back':
    case 'fix':
      decider.withdrawGates(task.id, (gate) => gate.type === 'review' || gate.type === 'merge');
      startFix(decider, task.id, 'you', resolveHumanFixPrompt(text), null);
  }
}

function resolveMessageKind(command: CommandOf<'task.message'>, task: Task, scheduled: boolean): MessageKind {
  if (command.kind) return command.kind;
  return scheduled && isTaskResting(task) ? 'new_round' : 'feedback';
}

function isOnlyRecorded(kind: MessageKind, delivery: MessageDelivery) {
  return kind === 'acknowledge' && delivery.effect !== 'supersede_question';
}

function startNewWork(decider: Decider, task: Task, command: CommandOf<'task.message'>, text: string) {
  const number = resolveNextRoundNumber(task);
  decider.emit({ type: 'task.messaged', taskId: task.id, text, kind: 'new_round', round: number });
  queueRound(decider, task.id, {
    request: text,
    title: command.title ?? null,
    why: command.why ?? null,
    shape: command.shape ?? null,
  });
}

function assertMessageAccepted(state: ShinsaState, task: Task, text: string) {
  if (text.length === 0) throw new DomainError('message_required', 'Write a message first.');
  const delivery = resolveMessageDelivery(state, task);
  if (delivery.effect === 'closed') {
    throw new DomainError('task_settled', 'This task is finished. Start a new one.');
  }
  return delivery;
}

export function messageTask(
  decider: Decider,
  command: CommandOf<'task.message'>,
  scheduleId: string | null = null
) {
  const task = decider.task(command.taskId);
  const text = command.text.trim();
  const delivery = assertMessageAccepted(decider.state, task, text);
  const sentForYou = decider.context.onBehalf === true || scheduleId !== null;
  if (sentForYou && listOpenGates(decider.state, task.id).length > 0) {
    decider.emit({ type: 'task.messaged', taskId: task.id, text, ...(scheduleId ? { scheduleId } : {}) });
    return;
  }
  const kind = resolveMessageKind(command, task, scheduleId !== null);
  if (kind === 'separate_task' && hasRoomForSuggestion(task)) {
    decider.emit({ type: 'task.messaged', taskId: task.id, text, kind });
    suggestSplitOff(decider, task.id, text, command.title ?? null, command.why ?? null);
    return;
  }
  if (kind === 'new_round' || kind === 'separate_task') {
    startNewWork(decider, task, command, text);
    return;
  }
  if (isOnlyRecorded(kind, delivery)) {
    decider.emit({ type: 'task.messaged', taskId: task.id, text, kind });
    return;
  }
  decider.emit({ type: 'task.messaged', taskId: task.id, text, ...(scheduleId ? { scheduleId } : {}) });
  deliverMessage(decider, decider.task(task.id), delivery, text);
}

export function redeliverMessage(decider: Decider, command: CommandOf<'message.deliver'>) {
  const task = decider.state.tasks[command.taskId];
  if (!task || isTaskSettled(task)) return;
  deliverMessage(decider, task, resolveDelivery(decider.state, task), command.text);
}

export function receiveMessage(decider: Decider, command: CommandOf<'message.receive'>) {
  const task = decider.task(command.taskId);
  const text = command.text.trim();
  assertMessageAccepted(decider.state, task, text);
  decider.emit({ type: 'task.message_received', taskId: task.id, messageId: decider.context.newId(), text });
}

export function routeMessage(decider: Decider, command: CommandOf<'message.route'>) {
  const { taskId, messageId, ...route } = command;
  const message = decider.state.tasks[taskId]?.inbox?.find((candidate) => candidate.id === messageId);
  if (!message) return;
  decider.emit({ type: 'task.message_routed', taskId, messageId });
  messageTask(decider, { ...route, type: 'task.message', taskId, text: message.text });
}

export function dropMessage(decider: Decider, command: CommandOf<'message.drop'>) {
  const { taskId, messageId, reason } = command;
  if (!decider.state.tasks[taskId]?.inbox?.some((candidate) => candidate.id === messageId)) return;
  decider.emit({ type: 'task.message_dropped', taskId, messageId, reason });
}
