import type { Queue, QueuedGate } from '../queue/types.ts';
import {
  listBriefingEntries,
  listNamedIds,
  resolveBriefingWhy,
  resolveFallbackBriefing,
  resolveFallbackNote,
} from './fallback.ts';
import { resolveNote } from './note.ts';
import { capitalise } from './text.ts';
import { BRIEFING_LIMITS, type Briefing, type BriefingItem } from './types.ts';

const ORDINAL_REFERENCE =
  /\b(?:item|entry|number|decision|task)\s+(?:#?\d+|one|two|three|four|five)\b|\b(?:first|second|third|fourth|last)\s+(?:one|item|entry|decision)\b/i;

const MERGE_CLAIM =
  /\b(?:ready to merge|ready for merging|mergeable|can be merged|merge it|safe to merge)\b/i;

function listQueueTaskIds(queue: Queue) {
  return [
    ...queue.ready.map((entry) => entry.task.id),
    ...queue.held.map((entry) => entry.task.id),
    ...queue.working.map((task) => task.id),
    ...queue.waiting.map((task) => task.id),
  ].map((id) => id.toLowerCase());
}

function cleanSentence(value: unknown, limit: number, ids: string[]) {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/!+/g, '.')
    .replace(/"([^"]+)"/g, '“$1”')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > limit || ORDINAL_REFERENCE.test(text)) return null;
  const lower = text.toLowerCase();
  if (ids.some((id) => lower.includes(id))) return null;
  return capitalise(text);
}

function cleanWhy(value: unknown, entry: QueuedGate, ids: string[]) {
  const text = cleanSentence(value, BRIEFING_LIMITS.why, ids)?.replace(/\.$/, '');
  if (!text) return null;
  if (entry.gate.kind !== 'merge' && MERGE_CLAIM.test(text)) return null;
  if (text.toLowerCase().startsWith(entry.task.title.toLowerCase())) return null;
  return text;
}

function readField(value: unknown, ...names: string[]) {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return names.map((name) => record[name]).find((field) => field !== undefined && field !== null);
}

function readTaskId(value: unknown) {
  const id = readField(value, 'task', 'task_id', 'taskId');
  return typeof id === 'string' ? id.trim() : null;
}

function isLow(entry: QueuedGate | undefined) {
  return entry?.task.priority === 'low';
}

function parseNext(raw: unknown, entries: Map<string, QueuedGate>, nowId: string, ids: string[]) {
  const picked = new Set([nowId]);
  const next: BriefingItem[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const id = readTaskId(item);
    const entry = id === null ? undefined : entries.get(id);
    if (!entry || picked.has(entry.task.id) || next.length >= BRIEFING_LIMITS.next) continue;
    picked.add(entry.task.id);
    next.push({
      taskId: entry.task.id,
      why: cleanWhy(readField(item, 'why'), entry, ids) ?? resolveBriefingWhy(entry),
    });
  }
  if (next.length > 0) {
    return next.sort((a, b) => Number(isLow(entries.get(a.taskId))) - Number(isLow(entries.get(b.taskId))));
  }
  return [...entries.values()]
    .filter((entry) => !picked.has(entry.task.id))
    .slice(0, BRIEFING_LIMITS.next)
    .map((entry) => ({ taskId: entry.task.id, why: resolveBriefingWhy(entry) }));
}

function parseNote(raw: unknown, queue: Queue, named: Set<string>, now: number, ids: string[]) {
  if (raw === null) return null;
  const written = cleanSentence(raw, BRIEFING_LIMITS.note, ids);
  if (written === null) return resolveFallbackNote(queue, named, now);
  return resolveNote(written, queue, named, now);
}

export function parseBriefing(raw: unknown, queue: Queue, now: number): Briefing | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const answer = raw as Record<string, unknown>;
  const fallback = resolveFallbackBriefing(queue, now);
  const entries = new Map(listBriefingEntries(queue).map((entry) => [entry.task.id, entry]));
  if (entries.size === 0) return fallback;

  const nowId = readTaskId(answer.now);
  const nowEntry = nowId === null ? undefined : entries.get(nowId);
  if (!nowEntry) return null;
  if (isLow(nowEntry) && [...entries.values()].some((entry) => !isLow(entry))) return null;

  const ids = listQueueTaskIds(queue);
  const next = parseNext(answer.next, entries, nowEntry.task.id, ids);
  const nowItem = {
    taskId: nowEntry.task.id,
    why: cleanWhy(readField(answer.now, 'why'), nowEntry, ids) ?? resolveBriefingWhy(nowEntry),
  };
  const note = parseNote(answer.note, queue, listNamedIds(nowItem, next), now, ids);
  return { now: nowItem, next, running: fallback.running, note };
}
