import type { CommandOf, MessageRoute } from '../commands/index.ts';
import {
  DomainError,
  type Gate,
  isAgentQuestion,
  isTaskClosed,
  isTaskResting,
  isTaskSettled,
  isWatchHome,
  listQueuedRounds,
  type MessageKind,
  MINUTE_MS,
  type Run,
  resolveCurrentRound,
  resolveNextRoundNumber,
  SHAPE_PIPELINES,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import type { EventOf } from '../events/index.ts';
import { resolveHumanFixPrompt } from '../prompts/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates, listRunningRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { queueMessageForWake } from './delegations.ts';
import { startFix } from './fixes.ts';
import { answerGate } from './gates.ts';
import { resolveCurrentPhase, startPhase, startPlanning } from './lifecycle.ts';
import { assertTakesMessages, findWaitingRound, isHeldByYourDecision, queueRound } from './rounds.ts';
import {
  acceptsFollowUp,
  answerFollowUp,
  followUpInquiry,
  noteOperation,
  restartAnswer,
  startInquiry,
  startOperation,
} from './shapes.ts';
import { findOpenSuggestion, hasRoomForSuggestion, suggestSplitOff } from './suggestions.ts';

type StageEffect =
  | 'kept'
  | 'revise_plan'
  | 'restart_step'
  | 'decline_proposal'
  | 'operation_notes'
  | 'request_changes'
  | 'send_back'
  | 'follow_up'
  | 'fix';

export type MessageEffect =
  | StageEffect
  | 'closed'
  | 'steer'
  | 'wake'
  | 'retry'
  | 'verify_setup'
  | 'supersede_question';

type Delivery =
  | { effect: 'steer' | 'wake'; run: Run }
  | { effect: 'retry' | 'verify_setup' | 'supersede_question'; gate: Gate }
  | { effect: StageEffect };

const FEEDBACK_ONLY_EFFECTS: ReadonlySet<MessageEffect> = new Set<MessageEffect>([
  'retry',
  'verify_setup',
  'supersede_question',
  'revise_plan',
  'request_changes',
  'decline_proposal',
  'operation_notes',
]);

const MESSAGE_REPEAT_WINDOW_MS = 10 * MINUTE_MS;

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
  watching: 'restart_step',
  awaiting_proposal: 'decline_proposal',
  awaiting_operation: 'operation_notes',
  answered: 'follow_up',
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

function isFeedbackOnly(effect: MessageEffect) {
  return FEEDBACK_ONLY_EFFECTS.has(effect);
}

export function needsMessageKind(state: ShinsaState, task: Task) {
  const effect = resolveMessageEffect(state, task);
  return effect !== 'closed' && !isFeedbackOnly(effect);
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
      startPhase(decider, task.id, resolveCurrentPhase(task), `\n\nThe human added: ${text}`);
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
      startFix(decider, task.id, 'you', resolveHumanFixPrompt(text, []), null);
  }
}

interface MessageSend extends MessageRoute {
  taskId: string;
  texts: string[];
}

function resolveMessageKind(
  send: MessageSend,
  task: Task,
  delivery: MessageDelivery,
  scheduled: boolean
): MessageKind {
  if (isFeedbackOnly(delivery.effect)) return 'feedback';
  if (send.kind) return send.kind;
  return scheduled && isTaskResting(task) ? 'new_round' : 'feedback';
}

function isNewWork(kind: MessageKind) {
  return kind === 'new_round' || kind === 'separate_task';
}

function isOnlyRecorded(kind: MessageKind, delivery: MessageDelivery) {
  return kind === 'acknowledge' && delivery.effect !== 'supersede_question';
}

function recordMessages(
  decider: Decider,
  taskId: string,
  texts: string[],
  fields: Partial<EventOf<'task.messaged'>>
) {
  for (const text of texts) decider.emit({ type: 'task.messaged', taskId, text, ...fields });
}

function startNewWork(decider: Decider, task: Task, send: MessageSend, texts: string[], request: string) {
  const round = resolveNextRoundNumber(task);
  recordMessages(decider, task.id, texts, { kind: 'new_round', round });
  queueRound(decider, task.id, {
    request,
    title: send.title ?? null,
    why: send.why ?? null,
    shape: send.shape ?? null,
  });
}

export function assertNotWatchHome(task: Task) {
  if (!isWatchHome(task)) return;
  throw new DomainError(
    'watch_home',
    'This is where a watch reads its integration, so it takes no messages. Change the watch in Settings → Automations.'
  );
}

function assertMessageAccepted(state: ShinsaState, task: Task, text: string) {
  if (text.length === 0) throw new DomainError('message_required', 'Write a message first.');
  assertNotWatchHome(task);
  const delivery = resolveMessageDelivery(state, task);
  if (delivery.effect === 'closed') {
    throw new DomainError('task_settled', 'This task is finished. Start a new one.');
  }
  return delivery;
}

function isRepeatedMessage(task: Task, text: string, now: number) {
  const isRecent = (at: number) => now - at <= MESSAGE_REPEAT_WINDOW_MS;
  return (
    (task.inbox ?? []).some((message) => message.text === text && isRecent(message.at)) ||
    listQueuedRounds(task).some((round) => round.request === text && isRecent(round.queuedAt))
  );
}

function isHeldForYou(state: ShinsaState, task: Task, kind: MessageKind) {
  return listOpenGates(state, task.id).some((gate) => gate.type !== 'result' || kind === 'new_round');
}

function sendMessages(decider: Decider, send: MessageSend, scheduleId: string | null) {
  const task = decider.task(send.taskId);
  const texts = send.texts.map((sent) => sent.trim()).filter((sent) => sent.length > 0);
  const text = texts.join('\n\n');
  const delivery = assertMessageAccepted(decider.state, task, text);
  if (isRepeatedMessage(task, text, decider.context.now)) return;
  const sentForYou = decider.context.onBehalf === true || scheduleId !== null;
  const scheduled = scheduleId ? { scheduleId } : {};
  const kind = resolveMessageKind(send, task, delivery, scheduleId !== null);
  if (sentForYou && isHeldForYou(decider.state, task, kind)) {
    recordMessages(decider, task.id, texts, { ...scheduled, kept: true });
    return;
  }
  if (kind === 'separate_task' && hasRoomForSuggestion(task)) {
    const suggestionId = decider.context.newId();
    recordMessages(decider, task.id, texts, { kind, suggestionId });
    suggestSplitOff(decider, task.id, suggestionId, text, send.title ?? null, send.why ?? null);
    return;
  }
  if (
    isNewWork(kind) &&
    !isHeldByYourDecision(decider.state, task, SHAPE_PIPELINES[send.shape ?? 'change'])
  ) {
    startNewWork(decider, task, send, texts, text);
    return;
  }
  if (isOnlyRecorded(kind, delivery)) {
    recordMessages(decider, task.id, texts, { kind });
    return;
  }
  recordMessages(decider, task.id, texts, scheduled);
  deliverMessage(decider, decider.task(task.id), delivery, text);
}

export function messageTask(
  decider: Decider,
  command: CommandOf<'task.message'>,
  scheduleId: string | null = null
) {
  const { type: _type, text, ...route } = command;
  sendMessages(decider, { ...route, texts: [text] }, scheduleId);
}

export function sendQueuedRound(decider: Decider, command: CommandOf<'round.send'>) {
  const round = findWaitingRound(decider.task(command.taskId), command.number);
  decider.emit({ type: 'round.removed', taskId: command.taskId, number: round.number });
  sendMessages(decider, { taskId: command.taskId, texts: [round.request], kind: 'feedback' }, null);
}

export function keepSuggestion(decider: Decider, command: CommandOf<'suggestion.keep'>) {
  const suggestion = findOpenSuggestion(decider, command.taskId, command.suggestionId);
  const task = decider.task(command.taskId);
  assertTakesMessages(task);
  const resting = isTaskResting(task);
  decider.emit({
    type: 'suggestion.settled',
    taskId: task.id,
    suggestionId: suggestion.id,
    status: 'dismissed',
    createdTaskId: null,
    keptRound: resting ? resolveNextRoundNumber(task) : resolveCurrentRound(task).number,
  });
  sendMessages(
    decider,
    {
      taskId: task.id,
      texts: [suggestion.request],
      kind: resting ? 'new_round' : 'feedback',
      title: suggestion.title,
      why: suggestion.why,
      ...(command.shape ? { shape: command.shape } : {}),
    },
    null
  );
}

export function redeliverMessage(decider: Decider, command: CommandOf<'message.deliver'>) {
  const task = decider.state.tasks[command.taskId];
  if (!task || isTaskSettled(task) || isWatchHome(task)) return;
  deliverMessage(decider, task, resolveDelivery(decider.state, task), command.text);
}

export function receiveMessage(decider: Decider, command: CommandOf<'message.receive'>) {
  const task = decider.task(command.taskId);
  const text = command.text.trim();
  assertMessageAccepted(decider.state, task, text);
  if (isRepeatedMessage(task, text, decider.context.now)) return;
  decider.emit({ type: 'task.message_received', taskId: task.id, messageId: decider.context.newId(), text });
}

function listInboxMessages(decider: Decider, taskId: string, messageIds: string[]) {
  const wanted = new Set(messageIds);
  return (decider.state.tasks[taskId]?.inbox ?? []).filter((message) => wanted.has(message.id));
}

export function routeMessage(decider: Decider, command: CommandOf<'message.route'>) {
  const { type: _type, taskId, messageIds, ...route } = command;
  const messages = listInboxMessages(decider, taskId, messageIds);
  if (messages.length === 0) return;
  for (const message of messages)
    decider.emit({ type: 'task.message_routed', taskId, messageId: message.id });
  sendMessages(decider, { ...route, taskId, texts: messages.map((message) => message.text) }, null);
}

export function dropMessage(decider: Decider, command: CommandOf<'message.drop'>) {
  const { taskId, messageIds, reason } = command;
  for (const message of listInboxMessages(decider, taskId, messageIds)) {
    decider.emit({ type: 'task.message_dropped', taskId, messageId: message.id, reason });
  }
}
