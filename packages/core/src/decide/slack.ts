import type { CommandOf } from '../commands/index.ts';
import { isTaskClosed } from '../domain/rounds.ts';
import { isSameSlackThread, type SlackThreadRef } from '../domain/slack.ts';
import type { Task } from '../domain/types.ts';
import type { ShinsaEventInput } from '../events/index.ts';
import { resolveSlackMentionThread, type SlackMention } from '../slack/contract.ts';
import { SLACK_POSTED_GATES, type SlackPost } from '../slack/posts.ts';
import { serializeSlackMessage, serializeSlackRequest } from '../slack/thread.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { messageTask, recordHeldMessage } from './messages.ts';
import { createTask } from './tasks.ts';

function selectThreadTask(decider: Decider, thread: SlackThreadRef): Task | null {
  return (
    Object.values(decider.state.tasks).find(
      (task) => task.slack && isSameSlackThread(task.slack, thread) && !isTaskClosed(task)
    ) ?? null
  );
}

function requestPost(
  decider: Decider,
  thread: SlackThreadRef,
  taskId: string | null,
  post: SlackPost,
  replaceTs: string | null = null
) {
  decider.run({ kind: 'slack.post', thread, taskId, post, replaceTs });
}

function forwardMention(decider: Decider, task: Task, mention: SlackMention, replaceTs: string | null) {
  const text = serializeSlackMessage(mention);
  const held = listOpenGates(decider.state, task.id).length > 0;
  if (held) recordHeldMessage(decider, task.id, text);
  else messageTask(decider, { type: 'task.message', taskId: task.id, text });
  const post: SlackPost = { kind: held ? 'held' : 'forwarded' };
  requestPost(decider, resolveSlackMentionThread(mention), task.id, post, replaceTs);
}

function resolveSlackProject(decider: Decider) {
  const projectId = decider.state.settings.slackProjectId ?? null;
  return projectId && decider.state.projects[projectId] ? projectId : undefined;
}

export function receiveSlackMention(decider: Decider, command: CommandOf<'slack.mention'>) {
  const linked = selectThreadTask(decider, resolveSlackMentionThread(command.mention));
  if (linked) {
    forwardMention(decider, linked, command.mention, null);
    return;
  }
  decider.run({ kind: 'slack.evaluate', mention: command.mention });
}

export function recordSlackEvaluation(decider: Decider, command: CommandOf<'slack.record_evaluation'>) {
  const { mention, statusTs, evaluation } = command;
  const thread = resolveSlackMentionThread(mention);
  const linked = selectThreadTask(decider, thread);
  if (linked) {
    forwardMention(decider, linked, mention, statusTs);
    return;
  }
  if (evaluation.kind === 'none') {
    requestPost(decider, thread, null, { kind: 'declined', reason: evaluation.reason }, statusTs);
    return;
  }
  const projectId = resolveSlackProject(decider);
  const taskId = createTask(decider, {
    type: 'task.create',
    request: serializeSlackRequest(mention, evaluation.request, decider.context.newId()),
    repoId: null,
    ...(projectId ? { projectId } : {}),
  });
  decider.emit({
    type: 'slack.thread_linked',
    taskId,
    link: { ...thread, userId: mention.userId, permalink: mention.permalink, statusTs },
  });
}

export function recordSlackStatus(decider: Decider, command: CommandOf<'slack.record_status'>) {
  const link = decider.state.tasks[command.taskId]?.slack;
  if (!link || link.statusTs === command.ts) return;
  decider.emit({ type: 'slack.status_posted', taskId: command.taskId, ts: command.ts });
}

function resolveEventTask(event: ShinsaEventInput) {
  if (event.type === 'gate.opened') return SLACK_POSTED_GATES.has(event.gate.type) ? event.gate.taskId : null;
  if (event.type === 'task.delivered' || event.type === 'task.staged') return event.taskId;
  if (event.type === 'slack.thread_linked') return event.taskId;
  return null;
}

function resolveEventPost(event: ShinsaEventInput): SlackPost | null {
  if (event.type === 'gate.opened') return { kind: 'gate', gateId: event.gate.id };
  if (event.type === 'task.delivered') return { kind: 'result' };
  return null;
}

export function syncSlackThreads(decider: Decider) {
  const restated = new Set<string>();
  for (const event of decider.events) {
    const taskId = resolveEventTask(event);
    const link = taskId ? decider.state.tasks[taskId]?.slack : null;
    if (!taskId || !link) continue;
    const post = resolveEventPost(event);
    if (post) requestPost(decider, link, taskId, post);
    if (restated.has(taskId)) continue;
    restated.add(taskId);
    decider.run({ kind: 'slack.status', taskId, thread: link });
  }
}
