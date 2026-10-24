import {
  type ChatEntry,
  capitalise,
  type DeliveringStep,
  type DisplayPhase,
  type Gate,
  listActiveRuns,
  listOpenGates,
  type Run,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';
import { RUN_ROLE } from '@/lib/chat/run-role.ts';
import { describeTool, resolvePresentVerb } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';
import { AGENT_STAGES } from '@/lib/format/labels.ts';
import { type Check, countPassing } from '@/lib/tasks/pull-request.ts';
import { describeWaitsOn } from '@/lib/tasks/roadmap.ts';
import { resolveTaskStatus } from '@/lib/tasks/status.ts';

export type NowTarget = 'review' | 'changes' | 'agent';

export const RETRY_NOTE = 'Reply in the chat to retry with guidance.';

export const RESULT_TITLE: Record<DeliveringStep, string> = {
  answer: 'Answered your question',
  investigate: 'Reported the diagnosis',
  research: 'Wrote the report',
  operate: 'Reported the outcome',
};

export type NowKind = 'gate' | 'usage_wait' | 'wait' | 'result' | 'work';

const SETTLED_TITLE: Partial<Record<Task['stage'], string>> = {
  merged: 'Merged. Nothing left to do.',
  done: 'Marked done.',
  cancelled: 'Cancelled.',
};

export function resolveNowTitle(
  task: Task,
  waitsOn: Task[],
  current: DisplayPhase | null,
  run: Run | undefined
) {
  if (waitsOn.length > 0) return describeWaitsOn(waitsOn);
  if (current?.planned) return current.title;
  if (!run && SETTLED_TITLE[task.stage]) return SETTLED_TITLE[task.stage] ?? '';
  return capitalise(task.stageReason);
}

export function describeFollowUpNote(step: DeliveringStep, role: Run['role'] | null) {
  if (step === 'operate')
    return 'Ask a follow-up or for more work in the chat. The agent answers a follow-up; more work starts a new round.';
  const who = role ? `the ${RUN_ROLE[role].name.toLowerCase()}` : 'the agent';
  return `Ask a follow-up in the chat and ${who} answers in the same conversation.`;
}

export function resolveNowKind(state: ShinsaState, task: Task, gate: Gate | undefined): NowKind {
  if (gate) return 'gate';
  if (listActiveRuns(state, task.id).length > 0) return 'work';
  if (isUsageWaitArmed(task)) return 'usage_wait';
  if (task.monitor?.status === 'armed') return 'wait';
  return task.stage === 'done' && task.result ? 'result' : 'work';
}

export function isResultInNowCard(state: ShinsaState, task: Task, gate: Gate | undefined) {
  if (!task.result) return false;
  if (gate) return gate.type === 'proposal';
  return resolveNowKind(state, task, gate) === 'result';
}

export function describeChecksPassed(checks: Check[]) {
  const passed = countPassing(checks);
  if (checks.length === 1) return passed === 1 ? 'The check passed' : 'The check failed';
  if (passed === checks.length) return `All ${checks.length} checks passed`;
  return `${passed} of ${formatCount(checks.length, 'check', 'checks')} passed`;
}

export function hasFailingCheck(checks: Check[]) {
  return checks.some((check) => check.outcome === 'fail');
}

export function isAgentWorking(state: ShinsaState, task: Task) {
  return AGENT_STAGES.has(task.stage) && listOpenGates(state, task.id).length === 0;
}

export function isTaskWatchable(state: ShinsaState, task: Task) {
  return resolveTaskStatus(state, task).tone !== 'neutral';
}

export function describeReviewFacts(task: Task, merge: boolean, spent: string | null) {
  const checks = task.checkResults ?? [];
  const findings = task.findings;
  const facts = [
    checks.length > 0 ? describeChecksPassed(checks) : null,
    findings.length === 0
      ? 'agent review found nothing'
      : `agent review left ${formatCount(findings.length, 'note', 'notes')}`,
    merge && task.pullRequest ? `PR #${task.pullRequest.number} is clean` : null,
    spent,
  ];
  return capitalise(facts.filter(Boolean).join(' · '));
}

function resolveFeedLine(entry: ChatEntry): { icon: IconName; label: string | null; text: string } | null {
  if (entry.type === 'agent') return { icon: 'IconBubbleText', label: null, text: entry.text };
  if (entry.type !== 'tool_call') return null;
  const description = describeTool(entry.tool);
  return { icon: description.icon, label: description.verb, text: description.target ?? '' };
}

export function listFeedLines(entries: ChatEntry[], limit: number) {
  const lines = entries
    .flatMap((entry) => {
      const line = resolveFeedLine(entry);
      return line ? [{ key: entry.id, ...line, text: line.text.split('\n')[0] ?? '' }] : [];
    })
    .slice(-limit);
  const latest = lines.at(-1);
  if (latest?.label) lines[lines.length - 1] = { ...latest, label: resolvePresentVerb(latest.label) };
  return lines;
}
