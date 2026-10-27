import {
  type Activity,
  capitalise,
  DAY_MS,
  isInFocus,
  isTaskComplete,
  type ShinsaState,
  type Task,
  type TaskStage,
} from '@shinsa/core';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import type { QueueSection } from '@/lib/queue.ts';

const RECENT_LIMIT = 5;

const FINISHED_WINDOW_MS = 7 * DAY_MS;

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
    if (shown.has(task.id) || !isInFocus(state, task, now)) continue;
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
        isInFocus(state, task, now)
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
  if (task.usageWait?.status === 'armed') return 'waiting for the usage limit on';
  if (task.monitor?.status === 'armed') return 'waiting to check in again on';
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
