import { STAGE_WORDS } from '../chat/references.ts';
import { capitalise, describeCount } from '../chat/text.ts';
import { isTaskClosed, isTaskResting } from '../domain/rounds.ts';
import type { Gate, Task, TaskStage } from '../domain/types.ts';
import { assembleReport } from '../report/assemble.ts';
import type { ShinsaState } from '../state/index.ts';
import { createSlackMessage, createSlackSection, type SlackMessage } from './blocks.ts';
import { escapeSlackText, listSlackChunks, serializeSlackMrkdwn } from './mrkdwn.ts';
import type { SlackPost } from './posts.ts';
import type { SlackSessionStatus } from './relay.ts';

export const SLACK_RESULT_LIMIT = 1500;

const SLACK_LEAD_LIMIT = 280;

const SLACK_DECLINED_TEXT = 'Not a task, so nothing was started.';

const SLACK_DECLINED_MRKDWN = '⚪ *Not a task*, so nothing was started.';

const NEEDS_YOU_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'awaiting_plan',
  'awaiting_review',
  'awaiting_merge',
  'awaiting_proposal',
  'awaiting_operation',
]);

const FINISHED_MARK: Partial<Record<TaskStage, string>> = { merged: '✅', done: '✅', cancelled: '⚪' };

const WAITING_MARK: Partial<Record<TaskStage, string>> = { triage: '⏳', waiting_on_tasks: '⏳' };

function describeTask(task: Task) {
  return task.handle ? `${task.handle} · ${task.title}` : task.title;
}

function describeTaskLink(task: Task, taskUrl: string) {
  return `<${taskUrl}|${escapeSlackText(describeTask(task)).replaceAll('|', '/')}>`;
}

function describeShinsaLink(label: string, taskUrl: string) {
  return `<${taskUrl}|${label}>`;
}

function resolveLead(text: string) {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  const sentence = /^(.+?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  return sentence.length > SLACK_LEAD_LIMIT
    ? `${sentence.slice(0, SLACK_LEAD_LIMIT - 1).trimEnd()}…`
    : sentence;
}

function resolveAttentionGate(gates: readonly Gate[]) {
  const open = gates.filter((gate) => gate.status === 'open');
  return (
    open.find((gate) => gate.type === 'failure' || gate.type === 'sign_in') ??
    open.find((gate) => gate.type === 'question' || gate.type === 'secret') ??
    null
  );
}

function resolveStatusMark(task: Task, attention: Gate | null) {
  if (attention) return attention.type === 'failure' || attention.type === 'sign_in' ? '🔴' : '🟣';
  if (NEEDS_YOU_STAGES.has(task.stage)) return '🟣';
  return FINISHED_MARK[task.stage] ?? WAITING_MARK[task.stage] ?? '🔵';
}

function describeStatusLabel(task: Task, attention: Gate | null) {
  if (attention) return `Needs you: ${attention.title}`;
  return capitalise(task.stageReason.trim() || STAGE_WORDS[task.stage]);
}

function describePullRequest(task: Task) {
  const pullRequest = task.pullRequest;
  return pullRequest ? `  ·  <${pullRequest.url}|PR #${pullRequest.number}>` : '';
}

export function resolveSlackSessionStatus(task: Task, gates: readonly Gate[]): SlackSessionStatus {
  if (isTaskClosed(task)) return 'closed';
  if (resolveAttentionGate(gates) || NEEDS_YOU_STAGES.has(task.stage)) return 'suspended';
  if (isTaskResting(task) || task.stage === 'merged') return 'active';
  return 'processing';
}

export function serializeSlackStatus(task: Task, gates: readonly Gate[], taskUrl: string): SlackMessage {
  const attention = resolveAttentionGate(gates);
  const label = describeStatusLabel(task, attention);
  const mark = resolveStatusMark(task, attention);
  return createSlackMessage(`${describeTask(task)}: ${label}`, [
    createSlackSection(
      `${mark} *${escapeSlackText(label)}*  ·  ${describeTaskLink(task, taskUrl)}${describePullRequest(task)}`
    ),
  ]);
}

function serializeQuestion(task: Task, gate: Gate, taskUrl: string) {
  const choices = (gate.choices ?? []).map((choice) =>
    choice === gate.recommendation ? `*${escapeSlackText(choice)}*` : escapeSlackText(choice)
  );
  return createSlackMessage(`${describeTask(task)} asks: ${gate.title}`, [
    createSlackSection(
      [
        `❓ *${escapeSlackText(gate.title)}*`,
        ...(choices.length > 0 ? [choices.join('  ·  ')] : []),
        describeShinsaLink('Answer in Shinsa', taskUrl),
      ].join('\n')
    ),
  ]);
}

function serializeSecret(task: Task, gate: Gate, taskUrl: string) {
  const label = gate.secret?.label ?? gate.title;
  return createSlackMessage(`${describeTask(task)} needs a secret: ${label}`, [
    createSlackSection(
      `🔑 *${escapeSlackText(label)}* is needed. Never paste it here.\n${describeShinsaLink('Give it in Shinsa', taskUrl)}`
    ),
  ]);
}

function serializePlan(task: Task, taskUrl: string) {
  const goal = resolveLead(task.plan?.document?.goal ?? task.title);
  return createSlackMessage(`${describeTask(task)} has a plan for you to approve.`, [
    createSlackSection(
      `📋 *Plan ready*  ${escapeSlackText(goal)}\n${describeShinsaLink('Review the plan in Shinsa', taskUrl)}`
    ),
  ]);
}

function describeChecks(task: Task) {
  const checks = assembleReport(task).checks;
  if (checks.length === 0) return null;
  const failed = checks.filter((check) => check.outcome === 'fail').length;
  if (failed === 0)
    return checks.length === 1
      ? '✓ The check passed'
      : `✓ All ${describeCount(checks.length, 'check')} passed`;
  return `✕ ${failed} of ${describeCount(checks.length, 'check')} failed`;
}

function serializeReview(task: Task, taskUrl: string) {
  const summary = resolveLead(task.summary?.trim() || assembleReport(task).headline);
  const facts = [describeChecks(task), describeShinsaLink('Review in Shinsa', taskUrl)].filter(Boolean);
  return createSlackMessage(`${describeTask(task)} is ready for your review.`, [
    createSlackSection(
      `👀 *Ready for review*  ${escapeSlackText(summary)}\n${facts.join('  ·  ')}${describePullRequest(task)}`
    ),
  ]);
}

function serializeProposal(task: Task, taskUrl: string) {
  const request = resolveLead(task.proposal?.request ?? '');
  return createSlackMessage(`${describeTask(task)} proposes a change.`, [
    createSlackSection(
      `💡 *Proposed change*  ${escapeSlackText(request)}\n${describeShinsaLink('Decide in Shinsa', taskUrl)}`
    ),
  ]);
}

export function serializeSlackGate(task: Task, gate: Gate, taskUrl: string): SlackMessage | null {
  switch (gate.type) {
    case 'question':
      return serializeQuestion(task, gate, taskUrl);
    case 'secret':
      return serializeSecret(task, gate, taskUrl);
    case 'plan':
      return serializePlan(task, taskUrl);
    case 'review':
      return serializeReview(task, taskUrl);
    case 'proposal':
      return serializeProposal(task, taskUrl);
    case 'merge':
    case 'operation':
    case 'failure':
    case 'configuration':
    case 'sign_in':
    case 'post_merge':
      return null;
  }
}

function resolveResultBody(task: Task) {
  const body = task.result?.body.trim() ?? '';
  if (body.length <= SLACK_RESULT_LIMIT) return { body, cut: false };
  const kept = body.slice(0, SLACK_RESULT_LIMIT);
  const end = Math.max(kept.lastIndexOf('\n'), kept.lastIndexOf(' '));
  return { body: `${(end > 0 ? kept.slice(0, end) : kept).trimEnd()}…`, cut: true };
}

export function serializeSlackResult(task: Task, taskUrl: string): SlackMessage | null {
  if (!task.result) return null;
  const { body, cut } = resolveResultBody(task);
  const { chunks } = listSlackChunks(serializeSlackMrkdwn(body), 2800, SLACK_RESULT_LIMIT + 100);
  return createSlackMessage(resolveLead(body) || describeTask(task), [
    ...chunks.map((chunk) => createSlackSection(chunk)),
    createSlackSection(describeShinsaLink(cut ? 'Read the rest in Shinsa' : 'Open in Shinsa', taskUrl)),
  ]);
}

export function serializeSlackForwarded(task: Task, taskUrl: string) {
  return createSlackMessage(`Sent to ${describeTask(task)}.`, [
    createSlackSection(`↪️ Sent to ${describeTaskLink(task, taskUrl)}`),
  ]);
}

export function serializeSlackHeld(task: Task, taskUrl: string) {
  return createSlackMessage(`Kept for ${describeTask(task)}. It waits on you in Shinsa.`, [
    createSlackSection(`📌 Kept for ${describeTaskLink(task, taskUrl)}. It waits on you in Shinsa.`),
  ]);
}

export function serializeSlackDeclined() {
  return createSlackMessage(SLACK_DECLINED_TEXT, [createSlackSection(SLACK_DECLINED_MRKDWN)]);
}

export function serializeSlackLinkPrompt(linkUrl: string) {
  return createSlackMessage('Connect Slack to your own Shinsa first.', [
    createSlackSection(
      `Connect Slack to your own Shinsa first, so the work runs on your machine.  <${linkUrl}|Connect Slack>`
    ),
  ]);
}

export function serializeSlackOffline(machineName: string) {
  return createSlackMessage(`${machineName} is offline, so nothing started.`, [
    createSlackSection(
      `🔌 *${escapeSlackText(machineName)}* is offline, so nothing started. Mention me again once Shinsa runs there.`
    ),
  ]);
}

export function resolveSlackPostMessage(
  state: ShinsaState,
  post: SlackPost,
  taskId: string,
  taskUrl: string
): SlackMessage | null {
  const task = state.tasks[taskId];
  if (!task) return null;
  if (post.kind === 'forwarded') return serializeSlackForwarded(task, taskUrl);
  if (post.kind === 'held') return serializeSlackHeld(task, taskUrl);
  if (post.kind === 'result') return serializeSlackResult(task, taskUrl);
  const gate = state.gates[post.gateId];
  return gate ? serializeSlackGate(task, gate, taskUrl) : null;
}

export function listSlackStatusGates(state: ShinsaState, taskId: string): Gate[] {
  return Object.values(state.gates).filter((gate) => gate.taskId === taskId && gate.status === 'open');
}
