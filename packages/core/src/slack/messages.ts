import { STAGE_WORDS } from '../chat/references.ts';
import { capitalise, describeCount } from '../chat/text.ts';
import type { DeliveringStep } from '../domain/shapes.ts';
import type { Gate, Task, TaskStage } from '../domain/types.ts';
import { type DisplayPhase, resolveTaskProgress } from '../progress/index.ts';
import { assembleReport } from '../report/assemble.ts';
import { listMergeSteps } from '../report/merge-steps.ts';
import type { WorkReport } from '../report/types.ts';
import type { ShinsaState } from '../state/index.ts';
import {
  createSlackActions,
  createSlackButton,
  createSlackContext,
  createSlackHeader,
  createSlackMessage,
  createSlackSection,
  SLACK_BLOCK_LIMITS,
  type SlackMessage,
} from './blocks.ts';
import { escapeSlackText, listSlackChunks, serializeSlackMrkdwn } from './mrkdwn.ts';
import type { SlackPost } from './posts.ts';

export const SLACK_RESULT_LIMIT = 12_000;

const OPEN_LABEL = 'Open in Shinsa';

const NEEDS_YOU_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'awaiting_plan',
  'awaiting_review',
  'awaiting_merge',
  'awaiting_proposal',
  'awaiting_operation',
]);

const FINISHED_MARK: Partial<Record<TaskStage, string>> = { merged: '✅', done: '✅', cancelled: '⚪' };

const WAITING_MARK: Partial<Record<TaskStage, string>> = { triage: '⏳', waiting_on_tasks: '⏳' };

const PHASE_MARK: Record<DisplayPhase['status'], string> = {
  done: '✓',
  active: '●',
  waiting: '◐',
  pending: '○',
  skipped: '',
  cancelled: '✕',
};

const RESULT_TITLE: Record<DeliveringStep, string> = {
  answer: 'Answer',
  investigate: 'Diagnosis',
  research: 'Report',
  operate: 'Operation outcome',
};

function describeTask(task: Task) {
  return task.handle ? `${task.handle} · ${task.title}` : task.title;
}

function describeTaskLink(task: Task, taskUrl: string) {
  return `<${taskUrl}|${escapeSlackText(task.title).replaceAll('|', '/')}>`;
}

function describeTaskContext(task: Task) {
  return task.handle ? `*${escapeSlackText(task.handle)}*` : '';
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

function describeStatusLine(task: Task, attention: Gate | null) {
  const mark = resolveStatusMark(task, attention);
  if (attention) return `${mark} *Needs you*  ${escapeSlackText(attention.title)}`;
  const stage = capitalise(STAGE_WORDS[task.stage]);
  const reason = task.stageReason.trim();
  const detail = reason.length > 0 && reason.toLowerCase() !== STAGE_WORDS[task.stage] ? reason : '';
  return detail ? `${mark} *${stage}*  ${escapeSlackText(detail)}` : `${mark} *${stage}*`;
}

function describePhase(phase: DisplayPhase) {
  const count = phase.count && phase.count.total > 1 ? ` ${phase.count.done}/${phase.count.total}` : '';
  return `${PHASE_MARK[phase.status]} ${escapeSlackText(phase.title)}${count}`;
}

function describeSteps(task: Task) {
  return resolveTaskProgress(task)
    .phases.filter((phase) => phase.status !== 'skipped')
    .map(describePhase)
    .join('   ');
}

function describePullRequest(task: Task) {
  const pullRequest = task.pullRequest;
  return pullRequest ? `<${pullRequest.url}|Pull request #${pullRequest.number}>` : '';
}

export function serializeSlackStatus(task: Task, gates: readonly Gate[], taskUrl: string): SlackMessage {
  const attention = resolveAttentionGate(gates);
  const line = describeStatusLine(task, attention);
  return createSlackMessage(`${describeTask(task)}: ${line.replace(/[*_]/g, '')}`, [
    createSlackSection(
      `*${describeTaskLink(task, taskUrl)}*\n${line}`,
      createSlackButton(OPEN_LABEL, taskUrl)
    ),
    createSlackContext([describeTaskContext(task), describeSteps(task), describePullRequest(task)]),
  ]);
}

function createFooter(task: Task, hint: string) {
  return createSlackContext([describeTaskContext(task), hint]);
}

function listMrkdwnSections(markdown: string, total: number) {
  const { chunks, cut } = listSlackChunks(serializeSlackMrkdwn(markdown), SLACK_BLOCK_LIMITS.section, total);
  return { sections: chunks.map((chunk) => createSlackSection(chunk)), cut };
}

function describeChoice(choice: string, recommendation: string | null | undefined) {
  const recommended = choice === recommendation ? '  _recommended_' : '';
  return `• ${escapeSlackText(choice)}${recommended}`;
}

function serializeQuestion(task: Task, gate: Gate, taskUrl: string) {
  const choices = gate.choices ?? [];
  const body = gate.body.trim().length > 0 ? listMrkdwnSections(gate.body, 6000).sections : [];
  return createSlackMessage(`${describeTask(task)} asks: ${gate.title}`, [
    createSlackHeader('Question'),
    createSlackSection(`*${escapeSlackText(gate.title)}*`),
    ...body,
    ...(choices.length > 0
      ? [createSlackSection(choices.map((choice) => describeChoice(choice, gate.recommendation)).join('\n'))]
      : []),
    createSlackActions([createSlackButton('Answer in Shinsa', taskUrl, true)]),
    createFooter(task, 'Or mention me in this thread with your answer.'),
  ]);
}

function serializeSecret(task: Task, gate: Gate, taskUrl: string) {
  const label = gate.secret?.label ?? gate.title;
  return createSlackMessage(`${describeTask(task)} needs a secret: ${label}`, [
    createSlackHeader('Secret needed'),
    createSlackSection(
      `*${escapeSlackText(label)}*\nGive it in Shinsa on the machine the task runs on. Never paste a secret in Slack.`
    ),
    createSlackActions([createSlackButton(OPEN_LABEL, taskUrl, true)]),
    createFooter(task, ''),
  ]);
}

function serializePlan(task: Task, taskUrl: string) {
  const plan = task.plan?.document;
  const phases = (plan?.phases ?? []).map(
    (phase, index) => `${index + 1}. *${escapeSlackText(phase.title)}*  ${escapeSlackText(phase.detail)}`
  );
  const facts = plan
    ? [
        describeCount(plan.files.length, 'file'),
        describeCount(plan.verification.length, 'check'),
        ...(plan.questions.length > 0 ? [describeCount(plan.questions.length, 'question')] : []),
      ].join(' · ')
    : '';
  return createSlackMessage(`${describeTask(task)} has a plan for you to approve.`, [
    createSlackHeader('Plan to approve'),
    createSlackSection(`*${describeTaskLink(task, taskUrl)}*\n${escapeSlackText(plan?.goal ?? task.title)}`),
    ...(phases.length > 0 ? [createSlackSection(phases.join('\n'))] : []),
    ...(facts ? [createSlackContext([facts])] : []),
    createSlackActions([createSlackButton('Review the plan', taskUrl, true)]),
    createFooter(task, 'Approve it in Shinsa. Mention me here to ask for changes.'),
  ]);
}

function describeChecks(task: Task, report: WorkReport) {
  const checks = report.checks;
  if (checks.length === 0) return '';
  const failed = checks.filter((check) => check.outcome === 'fail').length;
  const coverage =
    task.coverage?.status === 'measured' && task.coverage.executable > 0
      ? ` The tests cover ${task.coverage.covered} of ${task.coverage.executable} changed lines.`
      : '';
  const verdict =
    failed === 0
      ? `✅ *Checks*  All ${describeCount(checks.length, 'check')} passed.`
      : `❌ *Checks*  ${failed} of ${checks.length} did not pass.`;
  return `${verdict}${coverage}`;
}

function describeFindings(task: Task) {
  const open = task.findings.length;
  if (open === 0) return '';
  return `🔎 *Agent review*  ${describeCount(open, 'finding')} for you to weigh.`;
}

function describeRisks(report: WorkReport) {
  const risks = report.walkthrough?.risks ?? [];
  if (risks.length === 0) return '';
  const listed = risks
    .slice(0, 5)
    .map((risk) => `• ⚠️ *${escapeSlackText(risk.title)}*  ${escapeSlackText(risk.risk)}`);
  const more = risks.length > 5 ? [`_and ${describeCount(risks.length - 5, 'more risk')}_`] : [];
  return [`*Risks*`, ...listed, ...more].join('\n');
}

function describeMergeSteps(task: Task) {
  const steps = listMergeSteps(task).filter((step) => step.when === 'pre_merge');
  if (steps.length === 0) return '';
  return `☐ *Before the merge*  ${describeCount(steps.length, 'step')} for you, listed in Shinsa.`;
}

function serializeReview(task: Task, taskUrl: string) {
  const report = assembleReport(task);
  const summary = task.summary?.trim() || report.headline;
  const approach = report.walkthrough?.approach?.trim() ?? '';
  const facts = [describeChecks(task, report), describeFindings(task), describeMergeSteps(task)].filter(
    Boolean
  );
  const risks = describeRisks(report);
  const pullRequest = describePullRequest(task);
  return createSlackMessage(`${describeTask(task)} is ready for your review.`, [
    createSlackHeader('Ready for your review'),
    createSlackSection(`*${describeTaskLink(task, taskUrl)}*\n${serializeSlackMrkdwn(summary)}`),
    ...(approach ? [createSlackSection(`*Approach*\n${serializeSlackMrkdwn(approach)}`)] : []),
    ...(facts.length > 0 ? [createSlackSection(facts.join('\n'))] : []),
    ...(risks ? [createSlackSection(risks)] : []),
    createSlackActions([createSlackButton('Review in Shinsa', taskUrl, true)]),
    createFooter(
      task,
      [pullRequest, 'Approve it in Shinsa. Mention me here to ask for changes.'].filter(Boolean).join('  ·  ')
    ),
  ]);
}

function serializeProposal(task: Task, taskUrl: string) {
  const proposal = task.proposal;
  return createSlackMessage(`${describeTask(task)} proposes a change.`, [
    createSlackHeader('Change to approve'),
    createSlackSection(
      `*${describeTaskLink(task, taskUrl)}*\n${serializeSlackMrkdwn(proposal?.request ?? '')}`
    ),
    ...(proposal?.why ? [createSlackContext([`_Why:_ ${escapeSlackText(proposal.why)}`])] : []),
    createSlackActions([createSlackButton('Decide in Shinsa', taskUrl, true)]),
    createFooter(task, 'Approve it in Shinsa. Mention me here to say what to do instead.'),
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

export function serializeSlackResult(task: Task, taskUrl: string): SlackMessage | null {
  const result = task.result;
  if (!result) return null;
  const { sections, cut } = listMrkdwnSections(result.body, SLACK_RESULT_LIMIT);
  const title = RESULT_TITLE[result.step];
  return createSlackMessage(`${title} for ${describeTask(task)}`, [
    createSlackHeader(title),
    createSlackSection(`*${describeTaskLink(task, taskUrl)}*`),
    ...sections,
    ...(cut ? [createSlackContext(['_This is cut short. Read the rest in Shinsa._'])] : []),
    createSlackActions([createSlackButton(OPEN_LABEL, taskUrl)]),
    createFooter(task, ''),
  ]);
}

export function serializeSlackForwarded(task: Task, taskUrl: string) {
  return createSlackMessage(`Sent to ${describeTask(task)}.`, [
    createSlackContext([`↪️ Sent to ${describeTaskLink(task, taskUrl)}. It reads your message next.`]),
  ]);
}

export function serializeSlackDeclined(reason: string) {
  return createSlackMessage(`I didn't start a task. ${reason}`, [
    createSlackSection(`I didn't start a task. ${escapeSlackText(reason)}`),
    createSlackContext(['Mention me again with what you want done, and I will take it from there.']),
  ]);
}

export function serializeSlackReading() {
  return createSlackMessage('Reading the thread…', [createSlackContext(['👀 Reading the thread…'])]);
}

export function serializeSlackLinkPrompt(linkUrl: string) {
  return createSlackMessage('Connect Slack to your Shinsa to use me.', [
    createSlackSection(
      'I only take work from people who connected Slack to their own Shinsa, so the task runs on their machine.',
      createSlackButton('Connect Slack', linkUrl, true)
    ),
  ]);
}

export function serializeSlackOffline(machineName: string) {
  const name = escapeSlackText(machineName);
  return createSlackMessage(`${machineName} is offline, so I couldn't start anything.`, [
    createSlackSection(
      `🔌 *${name} is offline*, so I couldn't start anything. Mention me again once Shinsa is running there.`
    ),
  ]);
}

export function resolveSlackPostMessage(
  state: ShinsaState,
  post: SlackPost,
  taskId: string | null,
  taskUrl: string
): SlackMessage | null {
  const task = taskId ? state.tasks[taskId] : undefined;
  if (post.kind === 'declined') return serializeSlackDeclined(post.reason);
  if (!task) return null;
  if (post.kind === 'forwarded') return serializeSlackForwarded(task, taskUrl);
  if (post.kind === 'result') return serializeSlackResult(task, taskUrl);
  const gate = state.gates[post.gateId];
  return gate ? serializeSlackGate(task, gate, taskUrl) : null;
}

export function listSlackStatusGates(state: ShinsaState, taskId: string): Gate[] {
  return Object.values(state.gates).filter((gate) => gate.taskId === taskId && gate.status === 'open');
}
