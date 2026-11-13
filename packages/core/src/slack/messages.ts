import { Option } from 'effect';
import { STAGE_WORDS } from '../chat/references.ts';
import { capitalise, describeCount } from '../chat/text.ts';
import { isTaskClosed, isTaskResting, resolveCurrentRound } from '../domain/rounds.ts';
import type { DeliveringStep, TaskResult } from '../domain/shapes.ts';
import type { SlackDecided } from '../domain/slack.ts';
import type {
  Gate,
  GateDecision,
  GateType,
  MergeBlock,
  Task,
  TaskEscalation,
  TaskStage,
} from '../domain/types.ts';
import type { Watchdog, WatchdogStatus } from '../domain/watchdogs.ts';
import { assembleReport } from '../report/assemble.ts';
import { serializePlanMarkdown, serializeReportMarkdown } from '../report/markdown.ts';
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
  'browser_sign_in',
  'proposal',
  'operation',
  'plan',
  'review',
  'merge',
  'result',
];

const RESULT_HEADERS: Record<DeliveringStep, string> = {
  answer: 'Answer',
  research: 'Report',
  investigate: 'Diagnosis',
  operate: 'Outcome',
};

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
  body: string;
  version: number | null;
}

interface SlackReviewView {
  body: string;
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

function resolveOpenLabel(cut: boolean, label: string) {
  return cut ? 'Read the rest in Shinsa' : label;
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
    open.find(
      (gate) => gate.type === 'question' || gate.type === 'secret' || gate.type === 'browser_sign_in'
    ) ??
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

function hasGoneOnToChange(task: Task) {
  return task.proposal?.status === 'accepted' || task.plan !== null || task.pullRequest !== null;
}

function selectKeptResult(task: Task) {
  if (!task.result || resolveSlackStage(task) !== 'done' || hasGoneOnToChange(task)) return null;
  return task.result;
}

export function serializeSlackCard(task: Task, gates: readonly Gate[], taskUrl: string): SlackMessage {
  const gate = resolveCardGate(gates);
  const view = gate ? serializeSlackGate(task, gate, taskUrl) : Option.none();
  if (Option.isSome(view)) return view.value;
  const ref = resolveTaskRef(task, taskUrl);
  const kept = selectKeptResult(task);
  if (kept) return serializeSlackKeptResultView(ref, kept, task.slack?.decided);
  return serializeSlackStatusView(ref, resolveStatusLabel(task), task.slack?.decided);
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
  const { sections, cut } = listBodySections(
    view.context ? serializeQuote(view.context) : '',
    4 + (choices ? 1 : 0) + (recommended ? 1 : 0)
  );
  return createSlackMessage(`${ref.label} asks: ${view.question}`, [
    createSlackHeader('Question for you'),
    createSlackSection(`*${escapeSlackText(view.question)}*`),
    ...sections,
    ...(choices ? [choices] : []),
    ...(recommended ? [recommended] : []),
    createGateActions(gate, [
      ...answers,
      createWriteButton('Answer…', resolveDecisionValue(gate, 'reply'), answers.length === 0),
      createOpenButton(resolveOpenLabel(cut, 'Open in Shinsa'), ref.url, false),
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

function serializeSlackBrowserSignInView(ref: SlackTaskRef, site: string): SlackMessage {
  return createSlackMessage(`${ref.label} needs its browser signed in to ${site}`, [
    createSlackHeader('Sign-in needed'),
    createSlackSection(`*${escapeSlackText(site)}*\nSign in from Shinsa on the machine that runs the task.`),
    createSlackActions([createOpenButton('Open in Shinsa', ref.url)]),
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
  const { sections, cut } = listBodySections(view.body, 3);
  return createSlackMessage(`${ref.label} has a plan for you to approve.`, [
    createSlackHeader('Plan ready for your approval'),
    ...sections,
    createGateActions(gate, [
      ...listApproveButtons(gate, view.version),
      createOpenButton(resolveOpenLabel(cut, 'Read the plan'), ref.url, false),
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
  const { sections, cut } = listBodySections(view.body, 4);
  return createSlackMessage(`${ref.label} is ready for your review.`, [
    createSlackHeader('Ready for your review'),
    ...sections,
    createSlackFields([
      { label: 'Checks', value: escapeSlackText(view.checks ?? 'None ran') },
      { label: 'Pull request', value: serializePullRequestField(ref, 'Opens once you approve') },
    ]),
    createGateActions(gate, [
      ...listApproveButtons(gate),
      createOpenButton(resolveOpenLabel(cut, 'Review in Shinsa'), ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function serializeSlackMergeView(ref: SlackTaskRef, gate: Gate, view: SlackReviewView): SlackMessage {
  const { sections, cut } = listBodySections(view.body, 4);
  return createSlackMessage(`${ref.label} is ready to merge.`, [
    createSlackHeader('Ready to merge'),
    ...sections,
    createSlackFields([
      { label: 'Checks', value: escapeSlackText(view.checks ?? 'None ran') },
      { label: 'Pull request', value: serializePullRequestField(ref, 'Not open yet') },
    ]),
    createGateActions(gate, [
      createDecideButton('Merge', resolveDecisionValue(gate, 'approve'), true),
      createOpenButton(resolveOpenLabel(cut, 'Open in Shinsa'), ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function serializeSlackProposalView(
  ref: SlackTaskRef,
  gate: Gate,
  request: string,
  result: TaskResult | null
): SlackMessage {
  const change = serializeQuote(request || 'A change to the code.');
  const { sections, cut } = result
    ? listBodySections(serializeSlackMrkdwn(result.body.trim()), 4)
    : listBodySections(change, 3);
  return createSlackMessage(`${ref.label} proposes a change.`, [
    createSlackHeader(result ? RESULT_HEADERS[result.step] : 'Proposed change'),
    ...sections,
    ...(result ? [createSlackSection(`*Proposed change*\n${change}`)] : []),
    createGateActions(gate, [
      createDecideButton('Approve', resolveDecisionValue(gate, 'approve'), true),
      createDecideButton('Keep as is', resolveDecisionValue(gate, 'reject')),
      createOpenButton(resolveOpenLabel(cut, 'Open in Shinsa'), ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function listGateSections(gate: Gate) {
  const body = gate.body.trim() ? serializeQuote(gate.body) : null;
  return listBodySections(serializeLines([`*${escapeSlackText(gate.title)}*`, body]), 3);
}

function serializeSlackFailureView(ref: SlackTaskRef, gate: Gate): SlackMessage {
  const retry = gate.type === 'failure';
  const { sections, cut } = listGateSections(gate);
  return createSlackMessage(`${ref.label} needs you: ${gate.title}`, [
    createSlackHeader(retry ? 'Something failed' : 'Sign-in needed'),
    ...sections,
    createGateActions(gate, [
      ...(retry ? [createDecideButton('Retry', resolveDecisionValue(gate, 'approve'), true)] : []),
      createOpenButton(resolveOpenLabel(cut, 'Open in Shinsa'), ref.url, !retry),
    ]),
    serializeFooter(ref),
  ]);
}

function serializeSlackOperationView(ref: SlackTaskRef, gate: Gate): SlackMessage {
  const { sections, cut } = listGateSections(gate);
  return createSlackMessage(`${ref.label} is ready to run its operation.`, [
    createSlackHeader('Ready to run'),
    ...sections,
    createGateActions(gate, [
      createDecideButton('Run', resolveDecisionValue(gate, 'approve'), true),
      createDecideButton('Finish without it', resolveDecisionValue(gate, 'reject')),
      createOpenButton(resolveOpenLabel(cut, 'Open in Shinsa'), ref.url, false),
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
  const report = assembleReport(task);
  const summary = task.summary?.trim();
  const lead = summary && summary !== report.headline.trim() ? `${serializeQuote(summary)}\n` : null;
  return {
    body: serializeLines([lead, serializeSlackMrkdwn(serializeReportMarkdown(report))]),
    checks: describeCheckSummary(task),
  };
}

function resolvePlanBody(task: Task) {
  const document = task.plan?.document;
  return document ? serializeSlackMrkdwn(serializePlanMarkdown(document)) : serializeQuote(task.title);
}

export function serializeSlackGate(task: Task, gate: Gate, taskUrl: string): Option.Option<SlackMessage> {
  const ref = resolveTaskRef(task, taskUrl);
  switch (gate.type) {
    case 'question':
      return Option.some(
        serializeSlackQuestionView(ref, gate, {
          question: gate.title,
          context: gate.body.trim() || null,
          choices: gate.choices ?? [],
          recommendation: gate.recommendation ?? null,
        })
      );
    case 'secret':
      return Option.some(serializeSlackSecretView(ref, gate.secret?.label ?? gate.title));
    case 'browser_sign_in':
      return Option.some(serializeSlackBrowserSignInView(ref, gate.browserSignIn?.site ?? gate.title));
    case 'plan':
      return Option.some(
        serializeSlackPlanView(ref, gate, {
          body: resolvePlanBody(task),
          version: gate.planVersion ?? task.plan?.version ?? null,
        })
      );
    case 'review':
      return Option.some(serializeSlackReviewView(ref, gate, resolveReviewView(task)));
    case 'merge':
      return Option.some(serializeSlackMergeView(ref, gate, resolveReviewView(task)));
    case 'proposal':
      return Option.some(
        serializeSlackProposalView(ref, gate, task.proposal?.request ?? '', task.result ?? null)
      );
    case 'failure':
    case 'sign_in':
      return Option.some(serializeSlackFailureView(ref, gate));
    case 'operation':
      return Option.some(serializeSlackOperationView(ref, gate));
    case 'result':
      return task.result ? Option.some(serializeSlackResultView(ref, gate, task.result)) : Option.none();
    case 'configuration':
    case 'post_merge':
      return Option.none();
  }
}

function listBodySections(mrkdwn: string, fixedBlocks: number) {
  const { chunks, cut } = listSlackChunks(
    mrkdwn,
    SLACK_SECTION_SIZE,
    SLACK_BLOCK_LIMITS.blocks - fixedBlocks
  );
  const sections = cut ? [...chunks.slice(0, -1), `${chunks.at(-1) ?? ''}…`] : chunks;
  return { sections: sections.map((chunk) => createSlackSection(chunk)), cut };
}

function serializeSlackResultView(ref: SlackTaskRef, gate: Gate, result: TaskResult): SlackMessage {
  const body = result.body.trim();
  const { sections, cut } = listBodySections(serializeSlackMrkdwn(body), 3);
  return createSlackMessage(resolveLead(body) || ref.label, [
    createSlackHeader(RESULT_HEADERS[result.step]),
    ...sections,
    createGateActions(gate, [
      createDecideButton('Close', resolveDecisionValue(gate, 'approve'), true),
      createOpenButton(resolveOpenLabel(cut, 'Open in Shinsa'), ref.url, false),
    ]),
    serializeFooter(ref),
  ]);
}

function serializeSlackKeptResultView(
  ref: SlackTaskRef,
  result: TaskResult,
  decided: SlackDecided | null | undefined
): SlackMessage {
  const body = result.body.trim();
  const fixedBlocks = 2 + (decided ? 1 : 0);
  const { sections } = listBodySections(serializeSlackMrkdwn(body), fixedBlocks);
  return createSlackMessage(resolveLead(body) || ref.label, [
    createSlackHeader(RESULT_HEADERS[result.step]),
    ...sections,
    ...serializeDecided(decided),
    serializeFooter(ref),
  ]);
}

function serializeNote(fallback: string, title: string, detail: string, ref: SlackTaskRef | null) {
  return createSlackMessage(fallback, [
    createSlackSection(`*${escapeSlackText(title)}*\n${escapeSlackText(detail)}`),
    ...(ref ? [serializeFooter(ref)] : []),
  ]);
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

function describeSlackWait(minutes: number) {
  if (minutes % 60 !== 0) return describeCount(minutes, 'minute');
  return describeCount(minutes / 60, 'hour');
}

function describeSlackRatings(escalation: TaskEscalation) {
  const ratings = escalation.handoff.ratings;
  return ratings ? `${capitalise(ratings.confidence)} confidence, ${ratings.risk} risk` : 'Not rated';
}

const SLACK_MERGE_BLOCKS: Record<MergeBlock, string> = {
  self_approved: 'Its owner approved the review by hand, so a person merges it.',
  pre_merge_steps: 'A step before the merge is not ticked yet.',
  edits_not_pushed: 'Its owner’s edits are not pushed yet.',
};

function describeSlackEscalationNext({ handoff }: TaskEscalation) {
  if (handoff.blockedBy) return SLACK_MERGE_BLOCKS[handoff.blockedBy];
  if (handoff.mergesAt === null) return 'It waits until someone merges it.';
  return `Autopilot merges it ${serializeSlackDate(handoff.mergesAt)} unless someone acts first.`;
}

function describeSlackEscalationWhy({ handoff }: TaskEscalation) {
  const waited =
    handoff.waitedMinutes === 0
      ? 'It is urgent and ready to merge.'
      : `It is urgent and waited ${describeSlackWait(handoff.waitedMinutes)} for a merge.`;
  return handoff.foundBy ? `A watchdog found the issue it fixes. ${waited}` : waited;
}

interface SlackEscalationView {
  title: string;
  why: string;
  next: string;
  review: string;
  note: string | null;
}

function serializeSlackEscalationView(ref: SlackTaskRef, view: SlackEscalationView): SlackMessage {
  return createSlackMessage(`${ref.label} is urgent and needs a review.`, [
    ...(view.note ? [createSlackContext([escapeSlackText(view.note)])] : []),
    createSlackHeader('Urgent change needs a review'),
    createSlackSection(
      serializeLines([`*${escapeSlackText(view.title)}*`, escapeSlackText(view.why), view.next])
    ),
    createSlackFields([
      { label: 'Review', value: escapeSlackText(view.review) },
      { label: 'Pull request', value: serializePullRequestField(ref, 'Not open yet') },
    ]),
    createSlackActions([createOpenButton('Review in Shinsa', ref.url)]),
    serializeFooter(ref),
  ]);
}

export function serializeSlackEscalation(task: Task, escalation: TaskEscalation, taskUrl: string) {
  return serializeSlackEscalationView(resolveTaskRef(task, taskUrl), {
    title: task.title,
    why: describeSlackEscalationWhy(escalation),
    next: describeSlackEscalationNext(escalation),
    review: describeSlackRatings(escalation),
    note: null,
  });
}

export const SLACK_ESCALATION_TEST_NOTE = 'A test from Shinsa’s Autopilot settings. Nothing needs you.';

export function serializeSlackEscalationTest(settingsUrl: string, now: number) {
  return serializeSlackEscalationView(
    { label: 'Settings → Agents → Autopilot', url: settingsUrl, pullRequest: null },
    {
      title: 'Fix the checkout timeout',
      why: 'It is urgent and ready to merge.',
      next: `Autopilot merges it ${serializeSlackDate(now + 3_600_000)} unless someone acts first.`,
      review: 'High confidence, low risk',
      note: SLACK_ESCALATION_TEST_NOTE,
    }
  );
}

function describeSlackEscalationEnd(task: Task) {
  if (task.pullRequest?.state === 'merged') return 'Merged. What happens next is in the thread.';
  if (isTaskClosed(task)) return 'The task is closed.';
  return 'Its owner decided the merge in Shinsa.';
}

export function serializeSlackEscalationCleared(task: Task, taskUrl: string) {
  const ref = resolveTaskRef(task, taskUrl);
  return serializeNote(
    `${ref.label} no longer needs anyone.`,
    'No longer needs anyone',
    describeSlackEscalationEnd(task),
    ref
  );
}

export function resolveSlackEscalationMessage(
  state: ShinsaState,
  taskId: string,
  escalatedAt: number,
  taskUrl: string
): Option.Option<SlackMessage> {
  const task = state.tasks[taskId];
  if (!task) return Option.none();
  const escalation = task.escalation;
  if (escalation?.at === escalatedAt) return Option.some(serializeSlackEscalation(task, escalation, taskUrl));
  return Option.some(serializeSlackEscalationCleared(task, taskUrl));
}

export function resolveSlackEscalationFollowUp(
  state: ShinsaState,
  taskId: string,
  taskUrl: string
): Option.Option<SlackMessage> {
  const task = state.tasks[taskId];
  if (task?.pullRequest?.state !== 'merged') return Option.none();
  const round = resolveCurrentRound(task).number;
  const merged = serializeSlackMerged(task, round, taskUrl);
  const watched = (task.watchdogs ?? []).some((watchdog) => watchdog.round === round);
  const lead = watched
    ? '*Merged*\nShinsa keeps watching it after the merge. Keep an eye on it too.'
    : '*Merged*\nNothing watches it after the merge, so keep an eye on it.';
  return Option.some({ ...merged, blocks: [createSlackSection(lead), ...merged.blocks.slice(1)] });
}

export function serializeSlackDeclined() {
  return serializeNote('Not a task, so nothing was started.', 'Not a task', 'Nothing was started.', null);
}

export function serializeSlackNoAccess() {
  return serializeNote(
    'Your GitHub account no longer has access to this Shinsa, so nothing was started.',
    'No access to this Shinsa',
    'Nothing was started. Ask its owner to add you, or connect Slack to your own Shinsa.',
    null
  );
}

export function serializeSlackLinkPrompt(linkUrl: string) {
  return createSlackMessage('Connect Slack to your own Shinsa first.', [
    createSlackSection(
      '*Connect Slack first*\nConnect Slack to your own Shinsa, so the work runs on your machine.'
    ),
    createSlackActions([createOpenButton('Connect Slack', linkUrl)]),
  ]);
}

export function serializeSlackReconnectPrompt(linkUrl: string) {
  return createSlackMessage('Connect Slack again so I can read the threads you link.', [
    createSlackSection(
      '*Connect Slack again*\nConnect Slack again so I can read the threads you link. I read them as you, so I only see what you can.'
    ),
    createSlackActions([createOpenButton('Connect Slack', linkUrl)]),
  ]);
}

export function serializeSlackUnreadLinks(count: number) {
  return count === 1
    ? 'I could not read the thread you linked. Check that you can open it in Slack.'
    : `I could not read ${count} of the threads you linked. Check that you can open them in Slack.`;
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
): Option.Option<SlackMessage> {
  const task = state.tasks[taskId];
  return task
    ? Option.fromNullishOr(serializeSlackTripped(state, task, post.watchdogId, resolveTaskUrl))
    : Option.none();
}

export function resolveSlackMergeMessage(
  state: ShinsaState,
  taskId: string,
  round: number,
  taskUrl: string
): Option.Option<SlackMessage> {
  const task = state.tasks[taskId];
  return task ? Option.some(serializeSlackMerged(task, round, taskUrl)) : Option.none();
}

export function listSlackStatusGates(state: ShinsaState, taskId: string): Gate[] {
  return Object.values(state.gates).filter((gate) => gate.taskId === taskId && gate.status === 'open');
}
