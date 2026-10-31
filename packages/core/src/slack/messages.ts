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

const SLACK_PLAN_PHASES = 8;

export const SLACK_REACTIONS = {
  sizing: 'hourglass_flowing_sand',
  working: 'hammer_and_wrench',
  needsYou: 'raised_hand',
  done: 'white_check_mark',
  failed: 'x',
  cancelled: 'heavy_minus_sign',
} as const;

export type SlackReaction = (typeof SLACK_REACTIONS)[keyof typeof SLACK_REACTIONS];

const NEEDS_YOU_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'awaiting_plan',
  'awaiting_review',
  'awaiting_merge',
  'awaiting_proposal',
  'awaiting_operation',
]);

const SIZING_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>(['triage', 'waiting_on_tasks']);

export interface SlackTaskRef {
  label: string;
  url: string;
  pullRequest: { number: number; url: string } | null;
}

export interface SlackStatusView {
  label: string;
  detail: string | null;
}

export interface SlackQuestionView {
  question: string;
  context: string | null;
  choices: string[];
  recommendation: string | null;
}

export interface SlackPlanView {
  goal: string;
  phases: string[];
}

export interface SlackReviewView {
  summary: string;
  checks: string | null;
}

function resolveTaskRef(task: Task, taskUrl: string): SlackTaskRef {
  const pullRequest = task.pullRequest;
  return {
    label: task.handle ? `${task.handle} · ${task.title}` : task.title,
    url: taskUrl,
    pullRequest: pullRequest ? { number: pullRequest.number, url: pullRequest.url } : null,
  };
}

function serializeLink(label: string, url: string) {
  return `<${url}|${escapeSlackText(label).replaceAll('|', '/')}>`;
}

function serializeTaskLine(ref: SlackTaskRef) {
  const pullRequest = ref.pullRequest
    ? `  ·  ${serializeLink(`PR #${ref.pullRequest.number}`, ref.pullRequest.url)}`
    : '';
  return `${serializeLink(ref.label, ref.url)}${pullRequest}`;
}

function serializeQuote(text: string) {
  if (text.trim().length === 0) return null;
  return serializeSlackMrkdwn(text.trim())
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function serializeTitle(text: string) {
  return `*${escapeSlackText(text)}*`;
}

function serializePost(fallback: string, lines: (string | null)[]) {
  const text = lines.filter((line): line is string => line !== null && line.length > 0).join('\n');
  return createSlackMessage(fallback, [createSlackSection(text)]);
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

export function resolveSlackSessionStatus(task: Task, gates: readonly Gate[]): SlackSessionStatus {
  if (isTaskClosed(task)) return 'closed';
  if (resolveAttentionGate(gates) || NEEDS_YOU_STAGES.has(task.stage)) return 'suspended';
  if (isTaskResting(task) || task.stage === 'merged') return 'active';
  return 'processing';
}

export function resolveSlackReaction(task: Task, gates: readonly Gate[]): SlackReaction {
  if (task.stage === 'cancelled') return SLACK_REACTIONS.cancelled;
  if (isTaskClosed(task) || task.stage === 'merged') return SLACK_REACTIONS.done;
  const attention = resolveAttentionGate(gates);
  if (attention?.type === 'failure') return SLACK_REACTIONS.failed;
  if (attention || NEEDS_YOU_STAGES.has(task.stage)) return SLACK_REACTIONS.needsYou;
  if (isTaskResting(task)) return SLACK_REACTIONS.done;
  if (SIZING_STAGES.has(task.stage)) return SLACK_REACTIONS.sizing;
  return SLACK_REACTIONS.working;
}

function resolveStatusView(task: Task, gates: readonly Gate[]): SlackStatusView {
  const attention = resolveAttentionGate(gates);
  if (attention) return { label: 'Needs you', detail: attention.title };
  return { label: capitalise(task.stageReason.trim() || STAGE_WORDS[task.stage]), detail: null };
}

export function serializeSlackStatusView(ref: SlackTaskRef, view: SlackStatusView): SlackMessage {
  return serializePost(`${ref.label}: ${view.label}`, [
    serializeTitle(view.label),
    serializeQuote(view.detail ?? ''),
    serializeTaskLine(ref),
  ]);
}

export function serializeSlackStatus(task: Task, gates: readonly Gate[], taskUrl: string): SlackMessage {
  return serializeSlackStatusView(resolveTaskRef(task, taskUrl), resolveStatusView(task, gates));
}

export function serializeSlackQuestionView(ref: SlackTaskRef, view: SlackQuestionView): SlackMessage {
  const choices = view.choices.map((choice) =>
    choice === view.recommendation
      ? `•  ${escapeSlackText(choice)}  _(recommended)_`
      : `•  ${escapeSlackText(choice)}`
  );
  return serializePost(`${ref.label} asks: ${view.question}`, [
    serializeTitle('Question'),
    serializeQuote(view.question),
    view.context ? escapeSlackText(resolveLead(view.context)) : null,
    ...choices,
    serializeLink('Answer in Shinsa', ref.url),
  ]);
}

export function serializeSlackSecretView(ref: SlackTaskRef, label: string): SlackMessage {
  return serializePost(`${ref.label} needs a secret: ${label}`, [
    serializeTitle('Secret needed'),
    serializeQuote(label),
    'Give it in Shinsa, never in Slack.',
    serializeLink('Give it in Shinsa', ref.url),
  ]);
}

export function serializeSlackPlanView(ref: SlackTaskRef, view: SlackPlanView): SlackMessage {
  const phases = view.phases
    .slice(0, SLACK_PLAN_PHASES)
    .map((phase, index) => `${index + 1}.  ${escapeSlackText(phase)}`);
  const more = view.phases.length - phases.length;
  return serializePost(`${ref.label} has a plan for you to approve.`, [
    serializeTitle('Plan ready for your approval'),
    serializeQuote(view.goal),
    ...phases,
    more > 0 ? `_and ${describeCount(more, 'more phase')}_` : null,
    serializeLink('Review the plan in Shinsa', ref.url),
  ]);
}

export function serializeSlackReviewView(ref: SlackTaskRef, view: SlackReviewView): SlackMessage {
  const pullRequest = ref.pullRequest
    ? `  ·  ${serializeLink(`PR #${ref.pullRequest.number}`, ref.pullRequest.url)}`
    : '';
  return serializePost(`${ref.label} is ready for your review.`, [
    serializeTitle('Ready for your review'),
    serializeQuote(view.summary),
    view.checks,
    `${serializeLink('Review in Shinsa', ref.url)}${pullRequest}`,
  ]);
}

export function serializeSlackProposalView(ref: SlackTaskRef, request: string): SlackMessage {
  return serializePost(`${ref.label} proposes a change.`, [
    serializeTitle('Proposed change'),
    serializeQuote(request),
    serializeLink('Decide in Shinsa', ref.url),
  ]);
}

function describeChecks(task: Task) {
  const checks = assembleReport(task).checks;
  if (checks.length === 0) return null;
  const failed = checks.filter((check) => check.outcome === 'fail').length;
  if (failed === 0)
    return checks.length === 1 ? 'The check passed.' : `All ${describeCount(checks.length, 'check')} passed.`;
  return `${failed} of ${describeCount(checks.length, 'check')} failed.`;
}

function serializeQuestion(task: Task, gate: Gate, taskUrl: string) {
  return serializeSlackQuestionView(resolveTaskRef(task, taskUrl), {
    question: gate.title,
    context: gate.body.trim() || null,
    choices: gate.choices ?? [],
    recommendation: gate.recommendation ?? null,
  });
}

export function serializeSlackGate(task: Task, gate: Gate, taskUrl: string): SlackMessage | null {
  const ref = resolveTaskRef(task, taskUrl);
  switch (gate.type) {
    case 'question':
      return serializeQuestion(task, gate, taskUrl);
    case 'secret':
      return serializeSlackSecretView(ref, gate.secret?.label ?? gate.title);
    case 'plan':
      return serializeSlackPlanView(ref, {
        goal: task.plan?.document?.goal ?? task.title,
        phases: (task.plan?.document?.phases ?? []).map((phase) => phase.title),
      });
    case 'review':
      return serializeSlackReviewView(ref, {
        summary: resolveLead(task.summary?.trim() || assembleReport(task).headline),
        checks: describeChecks(task),
      });
    case 'proposal':
      return serializeSlackProposalView(ref, task.proposal?.request ?? '');
    case 'merge':
    case 'operation':
    case 'failure':
    case 'configuration':
    case 'sign_in':
    case 'post_merge':
      return null;
  }
}

function resolveResultBody(markdown: string) {
  const body = markdown.trim();
  if (body.length <= SLACK_RESULT_LIMIT) return { body, cut: false };
  const kept = body.slice(0, SLACK_RESULT_LIMIT);
  const end = Math.max(kept.lastIndexOf('\n'), kept.lastIndexOf(' '));
  return { body: `${(end > 0 ? kept.slice(0, end) : kept).trimEnd()}…`, cut: true };
}

export function serializeSlackResultView(ref: SlackTaskRef, markdown: string): SlackMessage {
  const { body, cut } = resolveResultBody(markdown);
  const { chunks } = listSlackChunks(serializeSlackMrkdwn(body), 2800, SLACK_RESULT_LIMIT + 100);
  return createSlackMessage(resolveLead(body) || ref.label, [
    ...chunks.map((chunk) => createSlackSection(chunk)),
    createSlackSection(serializeLink(cut ? 'Read the rest in Shinsa' : 'Open in Shinsa', ref.url)),
  ]);
}

export function serializeSlackResult(task: Task, taskUrl: string): SlackMessage | null {
  if (!task.result) return null;
  return serializeSlackResultView(resolveTaskRef(task, taskUrl), task.result.body);
}

export function serializeSlackForwardedView(ref: SlackTaskRef) {
  return serializePost(`Sent to ${ref.label}.`, [serializeTitle('Sent to the task'), serializeTaskLine(ref)]);
}

export function serializeSlackForwarded(task: Task, taskUrl: string) {
  return serializeSlackForwardedView(resolveTaskRef(task, taskUrl));
}

export function serializeSlackHeldView(ref: SlackTaskRef) {
  return serializePost(`Kept for ${ref.label}. It waits on you in Shinsa.`, [
    serializeTitle('Kept for the task'),
    'It waits on you in Shinsa, so its agent reads this once you decide.',
    serializeTaskLine(ref),
  ]);
}

export function serializeSlackHeld(task: Task, taskUrl: string) {
  return serializeSlackHeldView(resolveTaskRef(task, taskUrl));
}

export function serializeSlackDeclined() {
  return serializePost('Not a task, so nothing was started.', [
    serializeTitle('Not a task'),
    'Nothing was started.',
  ]);
}

export function serializeSlackLinkPrompt(linkUrl: string) {
  return serializePost('Connect Slack to your own Shinsa first.', [
    serializeTitle('Connect Slack first'),
    'Connect Slack to your own Shinsa, so the work runs on your machine.',
    serializeLink('Connect Slack', linkUrl),
  ]);
}

export function serializeSlackOffline(machineName: string) {
  return serializePost(`${machineName} is offline, so nothing was started.`, [
    serializeTitle(`${machineName} is offline`),
    'Nothing was started. Mention me again once Shinsa runs there.',
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
