import { STAGE_WORDS } from '../chat/references.ts';
import { capitalise, describeCount } from '../chat/text.ts';
import { isTaskClosed, isTaskResting } from '../domain/rounds.ts';
import type { SlackDecided } from '../domain/slack.ts';
import type { Gate, GateDecision, GateType, Task, TaskStage } from '../domain/types.ts';
import type { Watchdog, WatchdogStatus } from '../domain/watchdogs.ts';
import { assembleReport } from '../report/assemble.ts';
import { listOpenMergeSteps } from '../report/merge-steps.ts';
import type { ShinsaState } from '../state/index.ts';
import {
  createSlackActions,
  createSlackButton,
  createSlackContext,
  createSlackFields,
  createSlackHeader,
  createSlackMessage,
  createSlackSection,
  SLACK_BLOCK_LIMITS,
  type SlackButton,
  type SlackMessage,
} from './blocks.ts';
import {
  SLACK_DECIDE_ACTION,
  SLACK_GATE_BLOCK,
  SLACK_OPEN_ACTION,
  SLACK_WRITE_ACTION,
  serializeSlackDecisionValue,
} from './decisions.ts';
import { escapeSlackText, listSlackChunks, serializeSlackMrkdwn } from './mrkdwn.ts';
import type { SlackPost } from './posts.ts';
import type { SlackSessionStatus } from './relay.ts';
import type { SlackDecisionValue } from './schema.ts';

const SLACK_SECTION_SIZE = 2800;

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

export const SLACK_MENTION_REACTIONS = { forwarded: 'eyes', held: 'inbox_tray' } as const;

export type SlackMentionReaction = (typeof SLACK_MENTION_REACTIONS)[keyof typeof SLACK_MENTION_REACTIONS];

const SLACK_CARD_GATES: readonly GateType[] = [
  'failure',
  'sign_in',
  'question',
  'secret',
  'proposal',
  'operation',
  'plan',
  'review',
  'merge',
];

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

interface SlackQuestionView {
  question: string;
  context: string | null;
  choices: string[];
  recommendation: string | null;
}

interface SlackPlanView {
  goal: string;
  phases: string[];
  version: number | null;
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

function serializeTrustedLink(label: string, url: string) {
  return `<${url}|${escapeSlackText(label).replaceAll('|', '/')}>`;
}

function serializeFooter(ref: SlackTaskRef) {
  return createSlackContext([
    serializeTrustedLink(ref.label, ref.url),
    ...(ref.pullRequest ? [serializeTrustedLink(`PR #${ref.pullRequest.number}`, ref.pullRequest.url)] : []),
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

function resolveSlackStage(task: Task): TaskStage {
  if (task.stage !== 'watching') return task.stage;
  return task.pullRequest?.state === 'merged' ? 'merged' : 'done';
}

function resolveSlackTask(task: Task): Task {
  return task.stage === 'watching' ? { ...task, stage: resolveSlackStage(task) } : task;
}

export function resolveSlackSessionStatus(watched: Task, gates: readonly Gate[]): SlackSessionStatus {
  const task = resolveSlackTask(watched);
  if (isTaskClosed(task)) return 'closed';
  if (resolveAttentionGate(gates) || NEEDS_YOU_STAGES.has(task.stage)) return 'suspended';
  if (isTaskResting(task) || task.stage === 'merged' || task.stage === 'answered') return 'active';
  return 'processing';
}

export function resolveSlackReaction(watched: Task, gates: readonly Gate[]): SlackReaction {
  const task = resolveSlackTask(watched);
  if (task.stage === 'cancelled') return SLACK_REACTIONS.cancelled;
  if (isTaskClosed(task) || task.stage === 'merged' || task.stage === 'answered') return SLACK_REACTIONS.done;
  const attention = resolveAttentionGate(gates);
  if (attention?.type === 'failure') return SLACK_REACTIONS.failed;
  if (attention || NEEDS_YOU_STAGES.has(task.stage)) return SLACK_REACTIONS.needsYou;
  if (isTaskResting(task)) return SLACK_REACTIONS.done;
  if (SIZING_STAGES.has(task.stage)) return SLACK_REACTIONS.sizing;
  return SLACK_REACTIONS.working;
}

function serializeDecided(decided: SlackDecided | null | undefined) {
  return decided ? [createSlackContext([`<@${decided.userId}> ${decided.text}`])] : [];
}

function serializeSlackStatusView(
  ref: SlackTaskRef,
  label: string,
  decided?: SlackDecided | null
): SlackMessage {
  return createSlackMessage(`${ref.label}: ${label}`, [
    createSlackSection(`*${escapeSlackText(label)}*`),
    ...serializeDecided(decided),
    serializeFooter(ref),
  ]);
}

function resolveStatusLabel(task: Task) {
  if (task.stage === 'watching') return capitalise(STAGE_WORDS[resolveSlackStage(task)]);
  return capitalise(task.stageReason.trim() || STAGE_WORDS[task.stage]);
}

function resolveCardGate(gates: readonly Gate[]) {
  const open = gates.filter((gate) => gate.status === 'open');
  for (const type of SLACK_CARD_GATES) {
    const gate = open.find((candidate) => candidate.type === type);
    if (gate) return gate;
  }
  return null;
}

export function serializeSlackCard(task: Task, gates: readonly Gate[], taskUrl: string): SlackMessage {
  const gate = resolveCardGate(gates);
  const view = gate ? serializeSlackGate(task, gate, taskUrl) : null;
  return (
    view ??
    serializeSlackStatusView(resolveTaskRef(task, taskUrl), resolveStatusLabel(task), task.slack?.decided)
  );
}

function resolveDecisionValue(
  gate: Gate,
  decision: GateDecision,
  fields: Partial<Pick<SlackDecisionValue, 'choice' | 'planVersion'>> = {}
): SlackDecisionValue {
  return { gateId: gate.id, decision, choice: null, planVersion: null, ...fields };
}

function createDecideButton(label: string, value: SlackDecisionValue, primary = false) {
  const suffix = value.choice === null ? value.decision : `choice.${value.choice}`;
  return createSlackButton({
    actionId: `${SLACK_DECIDE_ACTION}.${suffix}`,
    label,
    value: serializeSlackDecisionValue(value),
    primary,
  });
}

function createWriteButton(label: string, value: SlackDecisionValue, primary = false) {
  return createSlackButton({
    actionId: `${SLACK_WRITE_ACTION}.${value.decision}`,
    label,
    value: serializeSlackDecisionValue(value),
    primary,
  });
}

function createGateActions(gate: Gate, buttons: readonly SlackButton[]) {
  return createSlackActions(buttons, `${SLACK_GATE_BLOCK}.${gate.id}`);
}

function listChoiceButtons(gate: Gate, view: SlackQuestionView) {
  if (view.choices.length === 0 || view.choices.length > SLACK_BLOCK_LIMITS.buttons) return [];
  return view.choices.map((choice, index) =>
    createDecideButton(
      choice,
      resolveDecisionValue(gate, 'reply', { choice: index }),
      choice === view.recommendation
    )
  );
}

function hasLongChoice(view: SlackQuestionView) {
  return (
    view.choices.length > SLACK_BLOCK_LIMITS.buttons ||
    view.choices.some((choice) => choice.length > SLACK_BLOCK_LIMITS.button)
  );
}

function serializeSlackQuestionView(ref: SlackTaskRef, gate: Gate, view: SlackQuestionView): SlackMessage {
  const answers = listChoiceButtons(gate, view);
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
    createGateActions(gate, [
      ...answers,
      createWriteButton('Answer…', resolveDecisionValue(gate, 'reply'), answers.length === 0),
      createOpenButton('Open in Shinsa', ref.url, false),
    ]),
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

function listApproveButtons(gate: Gate, planVersion: number | null = null) {
  return [
    createDecideButton('Approve', resolveDecisionValue(gate, 'approve', { planVersion }), true),
    createWriteButton('Request changes…', resolveDecisionValue(gate, 'revise')),
  ];
}

function serializeSlackPlanView(ref: SlackTaskRef, gate: Gate, view: SlackPlanView): SlackMessage {
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
    createGateActions(gate, [
      ...listApproveButtons(gate, view.version),
      createOpenButton('Read the plan', ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function serializePullRequestField(ref: SlackTaskRef, missing: string) {
  return ref.pullRequest
    ? serializeTrustedLink(`PR #${ref.pullRequest.number}`, ref.pullRequest.url)
    : missing;
}

function serializeSlackReviewView(ref: SlackTaskRef, gate: Gate, view: SlackReviewView): SlackMessage {
  return createSlackMessage(`${ref.label} is ready for your review.`, [
    createSlackHeader('Ready for your review'),
    createSlackSection(serializeQuote(view.summary)),
    createSlackFields([
      { label: 'Checks', value: escapeSlackText(view.checks ?? 'None ran') },
      { label: 'Pull request', value: serializePullRequestField(ref, 'Opens once you approve') },
    ]),
    createGateActions(gate, [
      ...listApproveButtons(gate),
      createOpenButton('Review in Shinsa', ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function serializeSlackMergeView(ref: SlackTaskRef, gate: Gate, view: SlackReviewView): SlackMessage {
  return createSlackMessage(`${ref.label} is ready to merge.`, [
    createSlackHeader('Ready to merge'),
    createSlackSection(serializeQuote(view.summary)),
    createSlackFields([
      { label: 'Checks', value: escapeSlackText(view.checks ?? 'None ran') },
      { label: 'Pull request', value: serializePullRequestField(ref, 'Not open yet') },
    ]),
    createGateActions(gate, [
      createDecideButton('Merge', resolveDecisionValue(gate, 'approve'), true),
      createOpenButton('Open in Shinsa', ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function serializeSlackProposalView(ref: SlackTaskRef, gate: Gate, request: string): SlackMessage {
  return createSlackMessage(`${ref.label} proposes a change.`, [
    createSlackHeader('Proposed change'),
    createSlackSection(serializeQuote(request || 'A change to the code.')),
    createGateActions(gate, [
      createDecideButton('Approve', resolveDecisionValue(gate, 'approve'), true),
      createDecideButton('Keep as is', resolveDecisionValue(gate, 'reject')),
      createOpenButton('Open in Shinsa', ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function serializeGateLines(gate: Gate) {
  const lead = gate.body.trim() ? resolveLead(gate.body) : null;
  return serializeLines([`*${escapeSlackText(gate.title)}*`, lead ? serializeQuote(lead) : null]);
}

function serializeSlackFailureView(ref: SlackTaskRef, gate: Gate): SlackMessage {
  const retry = gate.type === 'failure';
  return createSlackMessage(`${ref.label} needs you: ${gate.title}`, [
    createSlackHeader(retry ? 'Something failed' : 'Sign-in needed'),
    createSlackSection(serializeGateLines(gate)),
    createGateActions(gate, [
      ...(retry ? [createDecideButton('Retry', resolveDecisionValue(gate, 'approve'), true)] : []),
      createOpenButton('Open in Shinsa', ref.url, !retry),
    ]),
    serializeFooter(ref),
  ]);
}

function serializeSlackOperationView(ref: SlackTaskRef, gate: Gate): SlackMessage {
  return createSlackMessage(`${ref.label} is ready to run its operation.`, [
    createSlackHeader('Ready to run'),
    createSlackSection(serializeGateLines(gate)),
    createGateActions(gate, [
      createDecideButton('Run', resolveDecisionValue(gate, 'approve'), true),
      createDecideButton('Finish without it', resolveDecisionValue(gate, 'reject')),
      createOpenButton('Open in Shinsa', ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function describeCheckSummary(task: Task) {
  const checks = assembleReport(task).checks;
  if (checks.length === 0) return null;
  const failed = checks.filter((check) => check.outcome === 'fail').length;
  if (failed === 0)
    return checks.length === 1 ? 'The check passed.' : `All ${describeCount(checks.length, 'check')} passed.`;
  return `${failed} of ${describeCount(checks.length, 'check')} failed.`;
}

function resolveReviewView(task: Task): SlackReviewView {
  return {
    summary: resolveLead(task.summary?.trim() || assembleReport(task).headline),
    checks: describeCheckSummary(task),
  };
}

export function serializeSlackGate(task: Task, gate: Gate, taskUrl: string): SlackMessage | null {
  const ref = resolveTaskRef(task, taskUrl);
  switch (gate.type) {
    case 'question':
      return serializeSlackQuestionView(ref, gate, {
        question: gate.title,
        context: gate.body.trim() || null,
        choices: gate.choices ?? [],
        recommendation: gate.recommendation ?? null,
      });
    case 'secret':
      return serializeSlackSecretView(ref, gate.secret?.label ?? gate.title);
    case 'plan':
      return serializeSlackPlanView(ref, gate, {
        goal: task.plan?.document?.goal ?? task.title,
        phases: (task.plan?.document?.phases ?? []).map((phase) => phase.title),
        version: gate.planVersion ?? task.plan?.version ?? null,
      });
    case 'review':
      return serializeSlackReviewView(ref, gate, resolveReviewView(task));
    case 'merge':
      return serializeSlackMergeView(ref, gate, resolveReviewView(task));
    case 'proposal':
      return serializeSlackProposalView(ref, gate, task.proposal?.request ?? '');
    case 'failure':
    case 'sign_in':
      return serializeSlackFailureView(ref, gate);
    case 'operation':
      return serializeSlackOperationView(ref, gate);
    case 'configuration':
    case 'post_merge':
    case 'result':
      return null;
  }
}

function listBodySections(markdown: string, fixedBlocks: number) {
  const { chunks, cut } = listSlackChunks(
    serializeSlackMrkdwn(markdown),
    SLACK_SECTION_SIZE,
    SLACK_BLOCK_LIMITS.blocks - fixedBlocks
  );
  const sections = cut ? [...chunks.slice(0, -1), `${chunks.at(-1) ?? ''}…`] : chunks;
  return { sections: sections.map((chunk) => createSlackSection(chunk)), cut };
}

function serializeSlackResultView(ref: SlackTaskRef, markdown: string): SlackMessage {
  const body = markdown.trim();
  const { sections, cut } = listBodySections(body, 3);
  return createSlackMessage(resolveLead(body) || ref.label, [
    createSlackHeader('Result'),
    ...sections,
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

export function serializeSlackCompleted(task: Task, taskUrl: string) {
  const ref = resolveTaskRef(task, taskUrl);
  return serializeNote(`${ref.label} is done.`, 'Done', 'The task is finished.', ref);
}

interface SlackMergedView {
  watchdogs: string[];
  steps: string[];
}

const WATCHDOG_STATE_WORDS: Record<Exclude<WatchdogStatus, 'watching' | 'passed'>, string> = {
  needs_source: 'Waits for a data source.',
  awaiting_production: 'Waits for the change to reach production.',
  tripped: 'Found a problem.',
  stopped: 'Stopped.',
};

function serializeSlackDate(at: number) {
  return `<!date^${Math.floor(at / 1000)}^{date_short_pretty} at {time}|${new Date(at).toISOString()}>`;
}

function describeWatchdogState(watchdog: Watchdog) {
  if (watchdog.status === 'passed')
    return `Passed. Found nothing wrong in ${describeCount(watchdog.checks.length, 'check')}.`;
  if (watchdog.status !== 'watching') return WATCHDOG_STATE_WORDS[watchdog.status];
  const healthy = watchdog.checks.length > 0 ? ' Nothing wrong so far.' : '';
  if (watchdog.nextCheckAt === null) return `Watching.${healthy}`;
  return `Watching.${healthy} Next check ${serializeSlackDate(watchdog.nextCheckAt)}.`;
}

function serializeSlackMergedView(ref: SlackTaskRef, view: SlackMergedView): SlackMessage {
  const watchdogs =
    view.watchdogs.length > 0 ? [createSlackSection(serializeLines(['*Watchdogs*', ...view.watchdogs]))] : [];
  const steps =
    view.steps.length > 0
      ? [createSlackSection(serializeLines(['*Still to do after the merge*', ...view.steps]))]
      : [];
  return createSlackMessage(`${ref.label} is merged.`, [
    createSlackSection('*Merged*\nThe pull request is merged.'),
    ...watchdogs,
    ...steps,
    serializeFooter(ref),
  ]);
}

export function serializeSlackMerged(task: Task, round: number, taskUrl: string) {
  return serializeSlackMergedView(resolveTaskRef(task, taskUrl), {
    watchdogs: (task.watchdogs ?? [])
      .filter((watchdog) => watchdog.round === round)
      .map((watchdog) => `• *${escapeSlackText(watchdog.title)}*: ${describeWatchdogState(watchdog)}`),
    steps: listOpenMergeSteps(task, 'post_merge')
      .filter((step) => step.round === round)
      .map((step) => `• ${escapeSlackText(step.title)}`),
  });
}

interface SlackTrippedView {
  title: string;
  summary: string | null;
  filed: { label: string; url: string }[];
}

function serializeSlackTrippedView(ref: SlackTaskRef, view: SlackTrippedView): SlackMessage {
  const filed = view.filed.map((task) => `• ${serializeTrustedLink(task.label, task.url)}`);
  return createSlackMessage(`${ref.label}: the watchdog “${view.title}” found a problem.`, [
    createSlackHeader('Watchdog found a problem'),
    createSlackSection(
      serializeLines([
        `*${escapeSlackText(view.title)}*`,
        view.summary ? serializeQuote(resolveLead(view.summary)) : null,
      ])
    ),
    ...(filed.length > 0 ? [createSlackSection(serializeLines(['*Filed as*', ...filed]))] : []),
    serializeFooter(ref),
  ]);
}

function serializeSlackTripped(
  state: ShinsaState,
  task: Task,
  watchdogId: string,
  resolveTaskUrl: (taskId: string) => string
) {
  const watchdog = task.watchdogs?.find((candidate) => candidate.id === watchdogId);
  if (!watchdog) return null;
  const filed = [...new Set([...watchdog.forkTaskIds, ...watchdog.linkedTaskIds])].flatMap((id) => {
    const report = state.tasks[id];
    return report ? [resolveTaskRef(report, resolveTaskUrl(id))] : [];
  });
  return serializeSlackTrippedView(resolveTaskRef(task, resolveTaskUrl(task.id)), {
    title: watchdog.title,
    summary: watchdog.checks.at(-1)?.summary ?? null,
    filed,
  });
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

export function resolveSlackPostMessage(
  state: ShinsaState,
  post: SlackPost,
  taskId: string,
  resolveTaskUrl: (taskId: string) => string
): SlackMessage | null {
  const task = state.tasks[taskId];
  if (!task) return null;
  switch (post.kind) {
    case 'completed':
      return serializeSlackCompleted(task, resolveTaskUrl(taskId));
    case 'tripped':
      return serializeSlackTripped(state, task, post.watchdogId, resolveTaskUrl);
    case 'result':
      return serializeSlackResult(task, resolveTaskUrl(taskId));
  }
}

export function resolveSlackMergeMessage(
  state: ShinsaState,
  taskId: string,
  round: number,
  taskUrl: string
): SlackMessage | null {
  const task = state.tasks[taskId];
  return task ? serializeSlackMerged(task, round, taskUrl) : null;
}

export function listSlackStatusGates(state: ShinsaState, taskId: string): Gate[] {
  return Object.values(state.gates).filter((gate) => gate.taskId === taskId && gate.status === 'open');
}
