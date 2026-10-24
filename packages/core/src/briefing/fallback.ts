import { describeCount, describeList } from '../chat/text.ts';
import { DAY_MS, isPausingGate, type TaskStage } from '../domain/index.ts';
import { resolveGateWords } from '../queue/reasons.ts';
import type { Queue, QueuedGate } from '../queue/types.ts';
import { describeUnblocks, quote } from './text.ts';
import { BRIEFING_LIMITS, type Briefing, type BriefingItem } from './types.ts';

const STALE_MERGE_DAYS = 2;

const STAGE_VERB: Partial<Record<TaskStage, string>> = {
  triage: 'sorting out',
  planning: 'planning',
  building: 'building',
  checking: 'checking',
  shipping: 'shipping',
  answering: 'answering',
  investigating: 'investigating',
  researching: 'researching',
  operating: 'running',
};

export function listBriefingEntries(queue: Queue) {
  const seen = new Set<string>();
  return queue.ready.filter((entry) => {
    if (seen.has(entry.task.id)) return false;
    seen.add(entry.task.id);
    return true;
  });
}

export function listNamedIds(now: BriefingItem | null, next: BriefingItem[]) {
  return new Set([...(now ? [now.taskId] : []), ...next.map((item) => item.taskId)]);
}

export function resolveBriefingWhy(entry: QueuedGate) {
  const base = resolveGateWords(entry.gate).why(entry.gate, entry.task);
  const why = entry.unblocks > 0 ? `${base}, and it ${describeUnblocks(entry.unblocks)}` : base;
  return why.length > BRIEFING_LIMITS.why ? `${why.slice(0, BRIEFING_LIMITS.why - 1).trimEnd()}…` : why;
}

function resolveBriefingRunning(queue: Queue) {
  const [first, second, ...rest] = queue.working;
  if (!first) return 'No agent is working right now.';
  if (!second) return `An agent is ${STAGE_VERB[first.stage] ?? 'working on'} ${quote(first.title)}.`;
  const named = [quote(first.title), quote(second.title)];
  const titles = rest.length > 0 ? `${named.join(', ')} and ${rest.length} more` : describeList(named);
  return `Agents are working on ${titles}.`;
}

export function resolveFallbackNote(queue: Queue, named: Set<string>, now: number) {
  const entries = listBriefingEntries(queue).filter((entry) => !named.has(entry.task.id));
  const paused = entries.find((entry) => isPausingGate(entry.gate));
  if (paused) return `${quote(paused.task.title)} is paused and needs a decision.`;
  const stale = entries.find(
    (entry) => entry.gate.type === 'merge' && now - entry.gate.openedAt >= STALE_MERGE_DAYS * DAY_MS
  );
  if (stale) {
    const days = Math.floor((now - stale.gate.openedAt) / DAY_MS);
    return `${quote(stale.task.title)} has waited ${describeCount(days, 'day')} to merge.`;
  }
  const waiting = queue.waiting.length;
  if (waiting > 0) {
    return `${describeCount(waiting, 'task')} ${waiting === 1 ? 'is' : 'are'} waiting for another task to finish first.`;
  }
  return null;
}

export function resolveFallbackBriefing(queue: Queue, now: number): Briefing {
  const [first, ...rest] = listBriefingEntries(queue);
  const next = rest
    .slice(0, BRIEFING_LIMITS.next)
    .map((entry) => ({ taskId: entry.task.id, why: resolveBriefingWhy(entry) }));
  const nowItem = first ? { taskId: first.task.id, why: resolveBriefingWhy(first) } : null;
  return {
    now: nowItem,
    next,
    running: resolveBriefingRunning(queue),
    note: resolveFallbackNote(queue, listNamedIds(nowItem, next), now),
  };
}
