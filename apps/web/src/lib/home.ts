import {
  type Activity,
  capitalise,
  DAY_MS,
  describeCount,
  isActiveAt,
  isListedInFocus,
  isTaskComplete,
  resolveAutoPace,
  resolveActiveHours,
  type ShinsaState,
  type Task,
  type TaskStage,
} from '@shinsa/core';
import { Option } from 'effect';
import { isAdmissionWait, isPaceWait, isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';
import { formatMoment } from '@/lib/format/time.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import type { QueueSection } from '@/lib/queue.ts';
import { isResolvingConflicts } from '@/lib/tasks/status.ts';

const RECENT_LIMIT = 5;

const FINISHED_WINDOW_MS = DAY_MS;

const RUNNING_VERB: Partial<Record<TaskStage, string>> = {
  triage: 'sorting out',
  planning: 'planning',
  building: 'building',
  checking: 'checking',
  reviewing: 'reviewing',
  fixing: 'fixing',
  shipping: 'shipping',
  answering: 'answering',
  investigating: 'investigating',
  researching: 'researching',
  operating: 'running',
};

const PULL_REQUEST = /\b(?:(the|its)\s+)?(?:pull request|PR)\s+#\d+/gi;

export function listRecentConversations(state: ShinsaState, now: number, shown: ReadonlySet<string>) {
  const latest: { task: Task; entry: Activity }[] = [];
  for (const task of Object.values(state.tasks)) {
    if (shown.has(task.id) || !isListedInFocus(state, task, now)) continue;
    const entry = task.activity
      .filter((candidate) => candidate.actor === 'agent' && candidate.runId)
      .reduce<Activity | null>(
        (newest, candidate) => (newest && newest.at >= candidate.at ? newest : candidate),
        null
      );
    if (entry) latest.push({ task, entry });
  }
  return latest.sort((a, b) => b.entry.at - a.entry.at).slice(0, RECENT_LIMIT);
}

export function listRecentlyFinished(state: ShinsaState, now: number, shown: ReadonlySet<string>) {
  return Object.values(state.tasks)
    .filter(
      (task) =>
        !shown.has(task.id) &&
        isTaskComplete(task) &&
        now - task.stageChangedAt <= FINISHED_WINDOW_MS &&
        isListedInFocus(state, task, now)
    )
    .sort((a, b) => b.stageChangedAt - a.stageChangedAt)
    .slice(0, RECENT_LIMIT);
}

export function resolveHomeSectionId(key: QueueSection['key'] | 'finished' | 'conversations') {
  return createDisclosureId('home', 'section', key);
}

export function resolveHomeSections(state: ShinsaState, sections: QueueSection[], now: number) {
  const shown = new Set(sections.flatMap((section) => section.items.map((item) => item.task.id)));
  const finished = listRecentlyFinished(state, now, shown);
  for (const task of finished) shown.add(task.id);
  return {
    first: sections.filter((section) => !section.startsCollapsed),
    finished,
    conversations: listRecentConversations(state, now, shown),
    last: sections.filter((section) => section.startsCollapsed),
  };
}

export function resolveGreeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 5 || hour >= 18) return 'Good evening.';
  return hour < 12 ? 'Good morning.' : 'Good afternoon.';
}

export function resolveRunningVerb(task: Task) {
  if (isUsageWaitArmed(task)) {
    if (isAdmissionWait(task.usageWait)) return 'waiting to build';
    return isPaceWait(task.usageWait) ? 'held at a usage limit on' : 'waiting for the usage limit on';
  }
  if (task.monitor?.status === 'armed') return 'waiting to check in again on';
  if (isResolvingConflicts(task)) return 'resolving conflicts on';
  return RUNNING_VERB[task.stage] ?? 'working on';
}

export function resolvePreview(entry: Activity) {
  return (entry.text || entry.detail || '').split('\n')[0] ?? '';
}

export function dropPullRequestNumbers(text: string) {
  return text.replace(PULL_REQUEST, (match: string, determiner: string | undefined, offset: number) => {
    const phrase = `${determiner?.toLowerCase() ?? 'the'} pull request`;
    const startsSentence = /^[A-Z][a-z]/.test(match) || /(?:^|[.!?]\s+)$/.test(text.slice(0, offset));
    return startsSentence ? capitalise(phrase) : phrase;
  });
}

function listOvernightReviews(state: ShinsaState, now: number) {
  const hours = resolveActiveHours(state, now);
  if (Option.isNone(hours) || !isActiveAt(hours, now)) return [];
  return Object.values(state.gates).filter(
    (gate) =>
      gate.type === 'review' &&
      gate.status === 'open' &&
      now - gate.openedAt < DAY_MS &&
      !isActiveAt(hours, gate.openedAt)
  );
}

export interface WaitingBuild {
  task: Task;
  when: string;
}

export function isWaitingToBuild(task: Task) {
  return isUsageWaitArmed(task) && isAdmissionWait(task.usageWait);
}

function describeBuildTime(state: ShinsaState, task: Task, now: number) {
  const at = task.usageWait?.resetAt ?? now;
  const hours = resolveActiveHours(state, now);
  if (!isActiveAt(hours, at) && isActiveAt(hours, now)) return 'tonight';
  return at <= now ? 'next' : `after ${formatMoment(at, now)}`;
}

export function listWaitingBuilds(state: ShinsaState, working: readonly Task[], now: number): WaitingBuild[] {
  if (!resolveAutoPace(state.settings)) return [];
  return working
    .filter(isWaitingToBuild)
    .sort((a, b) => (a.usageWait?.resetAt ?? now) - (b.usageWait?.resetAt ?? now))
    .map((task) => ({ task, when: describeBuildTime(state, task, now) }));
}

export function describeOvernightReviews(state: ShinsaState, now: number) {
  if (!resolveAutoPace(state.settings)) return null;
  const built = listOvernightReviews(state, now);
  if (built.length === 0) return null;
  const verb = built.length === 1 ? 'is' : 'are';
  return `${describeCount(built.length, 'task')} built overnight ${verb} ready for your review`;
}
