import type { CommandOf } from '../commands/index.ts';
import { DomainError } from '../domain/errors.ts';
import { isTaskClosed, resolveCurrentRound } from '../domain/rounds.ts';
import {
  isSameSlackThread,
  type SlackEscalationPart,
  selectSlackEscalationPost,
  type SlackThreadRef,
} from '../domain/slack.ts';
import type { Gate, Task } from '../domain/types.ts';
import type { ShinsaEventInput } from '../events/index.ts';
import { resolveSlackMentionThread } from '../slack/contract.ts';
import { isSlackDecidable, resolveSlackDecidedText } from '../slack/decisions.ts';
import { SLACK_MENTION_REACTIONS, SLACK_REACTIONS } from '../slack/messages.ts';
import type { SlackPost } from '../slack/posts.ts';
import type { SlackDecision, SlackMention } from '../slack/schema.ts';
import { serializeSlackMessage, serializeSlackRequest } from '../slack/thread.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { answerGate } from './gates.ts';
import { messageTask, recordHeldMessage } from './messages.ts';
import { createTask } from './tasks.ts';

function selectThreadTask(decider: Decider, thread: SlackThreadRef): Task | null {
  return (
    Object.values(decider.state.tasks).find(
      (task) => task.slack && isSameSlackThread(task.slack, thread) && !isTaskClosed(task)
    ) ?? null
  );
}

function requestPost(decider: Decider, thread: SlackThreadRef, taskId: string, post: SlackPost) {
  decider.run({ kind: 'slack.post', thread, taskId, post });
}

function forwardMention(decider: Decider, task: Task, mention: SlackMention) {
  const text = serializeSlackMessage(mention, decider.context.newId());
  const held = listOpenGates(decider.state, task.id).length > 0;
  if (held) recordHeldMessage(decider, task.id, text);
  else messageTask(decider, { type: 'task.message', taskId: task.id, text });
  decider.run({
    kind: 'slack.react',
    thread: resolveSlackMentionThread(mention),
    messageTs: mention.messageTs,
    reaction: held ? SLACK_MENTION_REACTIONS.held : SLACK_MENTION_REACTIONS.forwarded,
  });
}

export function receiveSlackMention(decider: Decider, command: CommandOf<'slack.mention'>) {
  const linked = selectThreadTask(decider, resolveSlackMentionThread(command.mention));
  if (linked) {
    forwardMention(decider, linked, command.mention);
    return;
  }
  decider.run({ kind: 'slack.evaluate', mention: command.mention });
}

export function startSlackTask(decider: Decider, command: CommandOf<'slack.start_task'>) {
  const { mention } = command;
  const thread = resolveSlackMentionThread(mention);
  const linked = selectThreadTask(decider, thread);
  if (linked) {
    forwardMention(decider, linked, mention);
    return;
  }
  const taskId = createTask(decider, {
    type: 'task.create',
    request: serializeSlackRequest(mention, decider.context.newId()),
    repoId: null,
  });
  decider.emit({
    type: 'slack.thread_linked',
    taskId,
    link: {
      ...thread,
      userId: mention.userId,
      messageTs: mention.messageTs,
      permalink: mention.permalink,
      channelName: mention.channelName,
      statusTs: null,
      reaction: SLACK_REACTIONS.sizing,
    },
  });
}

export function recordSlackMerge(decider: Decider, command: CommandOf<'slack.record_merge'>) {
  const merge = decider.state.tasks[command.taskId]?.slack?.merge;
  if (!merge || merge.round !== command.round || merge.ts === command.ts) return;
  decider.emit({ type: 'slack.merge_posted', taskId: command.taskId, round: command.round, ts: command.ts });
}

export function recordSlackEscalation(decider: Decider, command: CommandOf<'slack.record_escalation'>) {
  const task = decider.state.tasks[command.taskId];
  if (!task || selectSlackEscalationPost(task.slackEscalations, command.escalatedAt, command.contact)) return;
  decider.emit({
    type: 'slack.escalation_sent',
    taskId: command.taskId,
    escalatedAt: command.escalatedAt,
    contact: command.contact,
    channelId: command.channelId,
    ts: command.ts,
    problem: command.problem,
  });
}

export function recordSlackEscalationFollowUp(
  decider: Decider,
  command: CommandOf<'slack.record_escalation_follow_up'>
) {
  const task = decider.state.tasks[command.taskId];
  const post = selectSlackEscalationPost(task?.slackEscalations, command.escalatedAt, command.contact);
  if (!post || post.followUpTs !== null) return;
  decider.emit({
    type: 'slack.escalation_followed_up',
    taskId: command.taskId,
    escalatedAt: command.escalatedAt,
    contact: command.contact,
    ts: command.ts,
  });
}

export function recordSlackStatus(decider: Decider, command: CommandOf<'slack.record_status'>) {
  const link = decider.state.tasks[command.taskId]?.slack;
  if (!link || (link.statusTs === command.ts && link.reaction === command.reaction)) return;
  decider.emit({
    type: 'slack.status_posted',
    taskId: command.taskId,
    ts: command.ts,
    reaction: command.reaction,
  });
}

function resolveSlackResponse(gate: Gate, decision: SlackDecision) {
  if (decision.choice === null) return decision.response?.trim() || null;
  const choice = gate.type === 'question' ? gate.choices?.[decision.choice] : undefined;
  if (choice === undefined)
    throw new DomainError({
      code: 'slack_decision_choice',
      message: 'That choice is no longer on the question. Answer it in Shinsa.',
    });
  return choice;
}

export function decideSlackGate(decider: Decider, command: CommandOf<'slack.decide'>) {
  const { decision } = command;
  const gate = decider.state.gates[decision.gateId];
  if (!gate) throw new DomainError({ code: 'slack_decision_closed', message: 'This is no longer open.' });
  const link = decider.state.tasks[gate.taskId]?.slack;
  if (!link || !isSameSlackThread(link, decision))
    throw new DomainError({
      code: 'slack_decision_refused',
      message: 'This decision belongs to another thread. Decide it in Shinsa.',
    });
  if (!isSlackDecidable(gate.type, decision.decision))
    throw new DomainError({ code: 'slack_decision_refused', message: 'Decide this one in Shinsa.' });
  const response = resolveSlackResponse(gate, decision);
  const planVersion = decision.planVersion === null ? {} : { planVersion: decision.planVersion };
  answerGate(decider, gate.id, decision.decision, response, planVersion);
  decider.emit({
    type: 'slack.decided',
    taskId: gate.taskId,
    decided: {
      userId: decision.userId,
      text: resolveSlackDecidedText(gate.type, decision.decision, response),
    },
  });
}

function resolveEventTask(state: ShinsaState, event: ShinsaEventInput) {
  switch (event.type) {
    case 'gate.answered':
    case 'gate.withdrawn':
    case 'gate.superseded':
      return state.gates[event.gateId]?.taskId ?? null;
    case 'gate.opened':
      return event.gate.taskId;
    case 'task.delivered':
    case 'task.staged':
    case 'slack.thread_linked':
    case 'slack.decided':
    case 'merge_step.ticked':
    case 'watchdog.armed':
    case 'watchdog.started':
    case 'watchdog.live':
    case 'watchdog.checking':
    case 'watchdog.deferred':
    case 'watchdog.missed':
    case 'watchdog.checked':
    case 'watchdog.report_linked':
    case 'watchdog.ended':
      return event.taskId;
    default:
      return null;
  }
}

const MERGE_EDIT_EVENTS: ReadonlySet<ShinsaEventInput['type']> = new Set<ShinsaEventInput['type']>([
  'watchdog.started',
  'watchdog.live',
  'watchdog.deferred',
  'watchdog.missed',
  'watchdog.checked',
  'watchdog.ended',
  'merge_step.ticked',
]);

function isWatchEvent(event: ShinsaEventInput) {
  return event.type.startsWith('watchdog.') || event.type === 'merge_step.ticked';
}

const WATCH_CHECK_EVENTS: ReadonlySet<ShinsaEventInput['type']> = new Set<ShinsaEventInput['type']>([
  'watchdog.deferred',
  'watchdog.checked',
  'watchdog.missed',
  'watchdog.ended',
]);

function listCheckedTasks(state: ShinsaState, events: readonly ShinsaEventInput[]) {
  return new Set(
    events.flatMap((event) => {
      const taskId = WATCH_CHECK_EVENTS.has(event.type) ? resolveEventTask(state, event) : null;
      return taskId ? [taskId] : [];
    })
  );
}

function listMergedTasks(events: readonly ShinsaEventInput[]) {
  return new Set(
    events.flatMap((event) => {
      const recorded = event.type === 'pull_request.updated' || event.type === 'pull_request.opened';
      return recorded && event.pullRequest.state === 'merged' ? [event.taskId] : [];
    })
  );
}

function isWatchStaging(event: ShinsaEventInput, checked: boolean) {
  if (event.type !== 'task.staged') return false;
  return event.stage === 'watching' || (checked && (event.stage === 'merged' || event.stage === 'done'));
}

function isMergeAnnouncement(task: Task, event: ShinsaEventInput, merging: boolean) {
  if (event.type !== 'task.staged' || event.stage !== 'merged' || !merging) return false;
  return task.slack?.merge?.round !== resolveCurrentRound(task).number;
}

function resolveEventPost(event: ShinsaEventInput): SlackPost | null {
  if (event.type === 'watchdog.checked' && event.status === 'tripped')
    return { kind: 'tripped', watchdogId: event.watchdogId };
  return null;
}

function announceMerge(decider: Decider, task: Task) {
  decider.emit({ type: 'slack.merge_announced', taskId: task.id, round: resolveCurrentRound(task).number });
}

function requestMergeMessages(decider: Decider, taskIds: ReadonlySet<string>) {
  for (const taskId of taskIds) {
    const link = decider.state.tasks[taskId]?.slack;
    if (!link?.merge) continue;
    const thread = { teamId: link.teamId, channelId: link.channelId, threadTs: link.threadTs };
    decider.run({ kind: 'slack.merge', thread, taskId, round: link.merge.round });
  }
}

function listClosedGateTasks(state: ShinsaState, events: readonly ShinsaEventInput[]) {
  return new Set(
    events.flatMap((event) => {
      const closed =
        event.type === 'gate.answered' || event.type === 'gate.withdrawn' || event.type === 'gate.superseded';
      const taskId = closed ? state.gates[event.gateId]?.taskId : undefined;
      return taskId ? [taskId] : [];
    })
  );
}

function requestEscalationEdits(
  decider: Decider,
  taskId: string,
  escalatedAt: number,
  part: SlackEscalationPart
) {
  for (const sent of decider.state.tasks[taskId]?.slackEscalations ?? []) {
    if (sent.escalatedAt !== escalatedAt || sent.ts === null) continue;
    decider.run({ kind: 'slack.escalate', taskId, escalatedAt, contact: sent.contact, part });
  }
}

function listFollowUpTasks(state: ShinsaState, events: readonly ShinsaEventInput[]) {
  const merged = listMergedTasks(events);
  const watched = events.flatMap((event) => {
    const taskId = MERGE_EDIT_EVENTS.has(event.type) ? resolveEventTask(state, event) : null;
    return taskId ? [taskId] : [];
  });
  return { merged, followUps: new Set([...merged, ...watched]) };
}

function resolveLastEscalation(task: Task) {
  const sent = (task.slackEscalations ?? []).filter((post) => post.ts !== null);
  return sent.length === 0 ? null : Math.max(...sent.map((post) => post.escalatedAt));
}

export function syncSlackEscalations(decider: Decider, before: ShinsaState) {
  const cleared = new Set<string>();
  for (const taskId of listClosedGateTasks(decider.state, decider.events)) {
    const escalation = before.tasks[taskId]?.escalation;
    if (!escalation || decider.state.tasks[taskId]?.escalation?.at === escalation.at) continue;
    cleared.add(taskId);
    requestEscalationEdits(decider, taskId, escalation.at, 'message');
  }
  for (const event of decider.events) {
    if (event.type !== 'task.escalation_revised') continue;
    const escalation = decider.state.tasks[event.taskId]?.escalation;
    if (escalation) requestEscalationEdits(decider, event.taskId, escalation.at, 'message');
  }
  const { merged, followUps } = listFollowUpTasks(decider.state, decider.events);
  for (const taskId of followUps) {
    const task = decider.state.tasks[taskId];
    const escalatedAt = task ? resolveLastEscalation(task) : null;
    if (!task || escalatedAt === null || task.pullRequest?.state !== 'merged') continue;
    if (merged.has(taskId) && !cleared.has(taskId))
      requestEscalationEdits(decider, taskId, escalatedAt, 'message');
    requestEscalationEdits(decider, taskId, escalatedAt, 'follow_up');
  }
}

export function syncSlackThreads(decider: Decider) {
  const events = [...decider.events];
  const checked = listCheckedTasks(decider.state, events);
  const merging = listMergedTasks(events);
  const restated = new Set<string>();
  const merges = new Set<string>();
  for (const event of events) {
    const taskId = resolveEventTask(decider.state, event);
    const task = taskId ? decider.state.tasks[taskId] : null;
    const link = task?.slack;
    if (!taskId || !task || !link) continue;
    const post = resolveEventPost(event);
    if (post) requestPost(decider, link, taskId, post);
    if (MERGE_EDIT_EVENTS.has(event.type)) merges.add(taskId);
    if (isMergeAnnouncement(task, event, merging.has(taskId))) {
      announceMerge(decider, task);
      merges.add(taskId);
    }
    if (isWatchEvent(event) || isWatchStaging(event, checked.has(taskId)) || restated.has(taskId)) continue;
    restated.add(taskId);
    decider.run({ kind: 'slack.status', taskId, thread: link });
  }
  requestMergeMessages(decider, merges);
}
