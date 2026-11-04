import type { CommandOf } from '../commands/index.ts';
import { DomainError } from '../domain/errors.ts';
import { isTaskClosed, resolveCurrentRound } from '../domain/rounds.ts';
import { isSameSlackThread, type SlackThreadRef } from '../domain/slack.ts';
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
  const text = serializeSlackMessage(mention);
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

function isQuietlyDone(task: Task) {
  return !task.result && task.pullRequest?.state !== 'merged';
}

function isWatchEvent(event: ShinsaEventInput) {
  return event.type.startsWith('watchdog.') || event.type === 'merge_step.ticked';
}

const WATCH_CHECK_EVENTS: ReadonlySet<ShinsaEventInput['type']> = new Set<ShinsaEventInput['type']>([
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

function isWatchStaging(event: ShinsaEventInput, checked: boolean) {
  if (event.type !== 'task.staged') return false;
  return event.stage === 'watching' || (checked && (event.stage === 'merged' || event.stage === 'done'));
}

function isMergeAnnouncement(task: Task, event: ShinsaEventInput, checked: boolean) {
  if (event.type !== 'task.staged' || event.stage !== 'merged' || checked) return false;
  return task.slack?.merge?.round !== resolveCurrentRound(task).number;
}

function resolveEventPost(task: Task, event: ShinsaEventInput): SlackPost | null {
  if (event.type === 'task.delivered') return { kind: 'result' };
  if (event.type === 'watchdog.checked' && event.status === 'tripped')
    return { kind: 'tripped', watchdogId: event.watchdogId };
  if (event.type !== 'task.staged') return null;
  return event.stage === 'done' && isQuietlyDone(task) ? { kind: 'completed' } : null;
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

export function syncSlackThreads(decider: Decider) {
  const events = [...decider.events];
  const checked = listCheckedTasks(decider.state, events);
  const restated = new Set<string>();
  const merges = new Set<string>();
  for (const event of events) {
    const taskId = resolveEventTask(decider.state, event);
    const task = taskId ? decider.state.tasks[taskId] : null;
    const link = task?.slack;
    if (!taskId || !task || !link) continue;
    const post = resolveEventPost(task, event);
    if (post) requestPost(decider, link, taskId, post);
    if (MERGE_EDIT_EVENTS.has(event.type)) merges.add(taskId);
    if (isMergeAnnouncement(task, event, checked.has(taskId))) {
      announceMerge(decider, task);
      merges.add(taskId);
    }
    if (isWatchEvent(event) || isWatchStaging(event, checked.has(taskId)) || restated.has(taskId)) continue;
    restated.add(taskId);
    decider.run({ kind: 'slack.status', taskId, thread: link });
  }
  requestMergeMessages(decider, merges);
}
