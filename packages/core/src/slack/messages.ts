import { STAGE_WORDS } from '../chat/references.ts';
import { capitalise, describeCount } from '../chat/text.ts';
import { isTaskClosed, isTaskResting } from '../domain/rounds.ts';
import type { Gate, Task, TaskStage } from '../domain/types.ts';
import { assembleReport } from '../report/assemble.ts';
import type { ShinsaState } from '../state/index.ts';
import {
  SLACK_ANSWER_ACTION,
  SLACK_OPEN_ACTION,
  SLACK_QUESTION_BLOCK,
  serializeSlackAnswerValue,
} from './answers.ts';
import {
  createSlackActions,
  createSlackButton,
  createSlackContext,
  createSlackFields,
  createSlackHeader,
  createSlackMessage,
  createSlackSection,
  SLACK_BLOCK_LIMITS,
  type SlackMessage,
} from './blocks.ts';
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

interface SlackStatusView {
  label: string;
  detail: string | null;
}

interface SlackQuestionView {
  gateId: string | null;
  question: string;
  context: string | null;
  choices: string[];
  recommendation: string | null;
}

interface SlackPlanView {
  goal: string;
  phases: string[];
}

interface SlackReviewView {
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

function serializeFooter(ref: SlackTaskRef) {
  return createSlackContext([
    serializeLink(ref.label, ref.url),
    ...(ref.pullRequest ? [serializeLink(`PR #${ref.pullRequest.number}`, ref.pullRequest.url)] : []),
  ]);
}

function serializeQuote(text: string) {
  return serializeSlackMrkdwn(text.trim())
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function serializeLines(lines: (string | null)[]) {
  return lines.filter((line): line is string => line !== null && line.length > 0).join('\n');
}

function createOpenButton(label: string, url: string, primary = true) {
  return createSlackButton({ actionId: SLACK_OPEN_ACTION, label, url, primary });
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

function serializeSlackStatusView(ref: SlackTaskRef, view: SlackStatusView): SlackMessage {
  return createSlackMessage(`${ref.label}: ${view.label}`, [
    createSlackSection(
      serializeLines([`*${escapeSlackText(view.label)}*`, view.detail ? serializeQuote(view.detail) : null])
    ),
    serializeFooter(ref),
  ]);
}

export function serializeSlackStatus(task: Task, gates: readonly Gate[], taskUrl: string): SlackMessage {
  return serializeSlackStatusView(resolveTaskRef(task, taskUrl), resolveStatusView(task, gates));
}

function listAnswerButtons(view: SlackQuestionView) {
  if (view.gateId === null || view.choices.length === 0 || view.choices.length > SLACK_BLOCK_LIMITS.buttons)
    return [];
  return view.choices.map((choice, index) =>
    createSlackButton({
      actionId: `${SLACK_ANSWER_ACTION}.${index}`,
      label: choice,
      value: serializeSlackAnswerValue(view.gateId ?? '', index),
      primary: choice === view.recommendation,
    })
  );
}

function hasLongChoice(view: SlackQuestionView) {
  return (
    view.choices.length > SLACK_BLOCK_LIMITS.buttons ||
    view.choices.some((choice) => choice.length > SLACK_BLOCK_LIMITS.button)
  );
}

function serializeSlackQuestionView(ref: SlackTaskRef, view: SlackQuestionView): SlackMessage {
  const answers = listAnswerButtons(view);
  const choices = hasLongChoice(view)
    ? createSlackSection(
        view.choices.map((choice, index) => `*${index + 1}.*  ${escapeSlackText(choice)}`).join('\n')
      )
    : null;
  const recommended = view.recommendation
    ? createSlackContext([`Recommended: *${escapeSlackText(view.recommendation)}*`])
    : null;
  return createSlackMessage(`${ref.label} asks: ${view.question}`, [
    createSlackHeader('Question for you'),
    createSlackSection(`*${escapeSlackText(view.question)}*`),
    ...(view.context ? [createSlackSection(serializeQuote(resolveLead(view.context)))] : []),
    ...(choices ? [choices] : []),
    ...(recommended ? [recommended] : []),
    createSlackActions(
      [...answers, createOpenButton('Answer in Shinsa', ref.url, answers.length === 0)],
      view.gateId !== null ? `${SLACK_QUESTION_BLOCK}.${view.gateId}` : undefined
    ),
    serializeFooter(ref),
  ]);
}

function serializeSlackSecretView(ref: SlackTaskRef, label: string): SlackMessage {
  return createSlackMessage(`${ref.label} needs a secret: ${label}`, [
    createSlackHeader('Secret needed'),
    createSlackSection(`*${escapeSlackText(label)}*\nGive it in Shinsa, never in Slack.`),
    createSlackActions([createOpenButton('Give it in Shinsa', ref.url)]),
    serializeFooter(ref),
  ]);
}

function serializeSlackPlanView(ref: SlackTaskRef, view: SlackPlanView): SlackMessage {
  const phases = view.phases
    .slice(0, SLACK_PLAN_PHASES)
    .map((phase, index) => `*${index + 1}.*  ${escapeSlackText(phase)}`);
  const more = view.phases.length - phases.length;
  return createSlackMessage(`${ref.label} has a plan for you to approve.`, [
    createSlackHeader('Plan ready for your approval'),
    createSlackSection(serializeQuote(view.goal)),
    ...(phases.length > 0
      ? [
          createSlackSection(
            serializeLines([...phases, more > 0 ? `_and ${describeCount(more, 'more phase')}_` : null])
          ),
        ]
      : []),
    createSlackActions([createOpenButton('Review the plan', ref.url)]),
    serializeFooter(ref),
  ]);
}

function serializeSlackReviewView(ref: SlackTaskRef, view: SlackReviewView): SlackMessage {
  const pullRequest = ref.pullRequest
    ? serializeLink(`PR #${ref.pullRequest.number}`, ref.pullRequest.url)
    : 'Opens once you approve';
  return createSlackMessage(`${ref.label} is ready for your review.`, [
    createSlackHeader('Ready for your review'),
    createSlackSection(serializeQuote(view.summary)),
    createSlackFields([
      { label: 'Checks', value: escapeSlackText(view.checks ?? 'None ran') },
      { label: 'Pull request', value: pullRequest },
    ]),
    createSlackActions([createOpenButton('Review in Shinsa', ref.url)]),
    serializeFooter(ref),
  ]);
}

function serializeSlackProposalView(ref: SlackTaskRef, request: string): SlackMessage {
  return createSlackMessage(`${ref.label} proposes a change.`, [
    createSlackHeader('Proposed change'),
    createSlackSection(serializeQuote(request || 'A change to the code.')),
    createSlackActions([createOpenButton('Decide in Shinsa', ref.url)]),
    serializeFooter(ref),
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
    gateId: gate.id,
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

function serializeSlackResultView(ref: SlackTaskRef, markdown: string): SlackMessage {
  const { body, cut } = resolveResultBody(markdown);
  const { chunks } = listSlackChunks(serializeSlackMrkdwn(body), 2800, SLACK_RESULT_LIMIT + 100);
  return createSlackMessage(resolveLead(body) || ref.label, [
    createSlackHeader('Result'),
    ...chunks.map((chunk) => createSlackSection(chunk)),
    createSlackActions([
      createOpenButton(cut ? 'Read the rest in Shinsa' : 'Open in Shinsa', ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

export function serializeSlackResult(task: Task, taskUrl: string): SlackMessage | null {
  if (!task.result) return null;
  return serializeSlackResultView(resolveTaskRef(task, taskUrl), task.result.body);
}

function serializeNote(fallback: string, title: string, detail: string, ref: SlackTaskRef | null) {
  return createSlackMessage(fallback, [
    createSlackSection(`*${escapeSlackText(title)}*\n${escapeSlackText(detail)}`),
    ...(ref ? [serializeFooter(ref)] : []),
  ]);
}

function serializeSlackForwardedView(ref: SlackTaskRef) {
  return serializeNote(`Sent to ${ref.label}.`, 'Sent to the task', 'Its agent reads it next.', ref);
}

export function serializeSlackForwarded(task: Task, taskUrl: string) {
  return serializeSlackForwardedView(resolveTaskRef(task, taskUrl));
}

function serializeSlackHeldView(ref: SlackTaskRef) {
  return serializeNote(
    `Kept for ${ref.label}. It waits on you in Shinsa.`,
    'Kept for the task',
    'It waits on you in Shinsa, so its agent reads this once you decide.',
    ref
  );
}

export function serializeSlackHeld(task: Task, taskUrl: string) {
  return serializeSlackHeldView(resolveTaskRef(task, taskUrl));
}

export function serializeSlackDeclined() {
  return serializeNote('Not a task, so nothing was started.', 'Not a task', 'Nothing was started.', null);
}

export function serializeSlackLinkPrompt(linkUrl: string) {
  return createSlackMessage('Connect Slack to your own Shinsa first.', [
    createSlackSection(
      '*Connect Slack first*\nConnect Slack to your own Shinsa, so the work runs on your machine.'
    ),
    createSlackActions([createOpenButton('Connect Slack', linkUrl)]),
  ]);
}

export function serializeSlackOffline(machineName: string) {
  return serializeNote(
    `${machineName} is offline, so nothing was started.`,
    `${machineName} is offline`,
    'Nothing was started. Mention me again once Shinsa runs there.',
    null
  );
}

export function serializeSlackAnsweredView(choice: string, userId: string) {
  return createSlackContext([`<@${userId}> answered *${escapeSlackText(choice)}*`]);
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
