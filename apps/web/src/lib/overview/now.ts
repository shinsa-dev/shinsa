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
  STEP_SCHEMA,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';
import { RUN_ROLE } from '@/lib/chat/run-role.ts';
import { describeTool, resolvePresentVerb } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';
import { AGENT_STAGES } from '@/lib/format/labels.ts';
import { describeChecksPassed } from '@/lib/tasks/checks.ts';
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
  if (task.stage === 'checking') return capitalise(task.stageReason);
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
  const working = listActiveRuns(state, task.id).length > 0;
  if (gate && !(gate.type === 'post_merge' && working)) return 'gate';
  if (working) return 'work';
  if (isUsageWaitArmed(task)) return 'usage_wait';
  if (task.monitor?.status === 'armed') return 'wait';
  return task.stage === 'done' && task.result ? 'result' : 'work';
}

type ResultPlace = 'now_card' | 'panel' | 'hidden';

const DELIVERING_STAGES: ReadonlySet<Task['stage']> = new Set(
  (Object.keys(RESULT_TITLE) as DeliveringStep[]).flatMap((step) => STEP_SCHEMA[step].stages)
);

export function resolveResultPlace(state: ShinsaState, task: Task, gate: Gate | undefined): ResultPlace {
  if (!task.result) return 'hidden';
  if (gate?.type === 'proposal') return 'now_card';
  if (DELIVERING_STAGES.has(task.stage)) return 'hidden';
  if (gate) return 'panel';
  return resolveNowKind(state, task, gate) === 'result' ? 'now_card' : 'panel';
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
