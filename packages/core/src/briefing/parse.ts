import { Option, Predicate, Schema } from 'effect';
import { capitalise } from '../chat/text.ts';
import type { Queue, QueuedGate } from '../queue/types.ts';
import {
  listBriefingEntries,
  listNamedIds,
  resolveBriefingWhy,
  resolveFallbackBriefing,
  resolveFallbackNote,
} from './fallback.ts';
import { Salvaged, SalvagedItems, SalvagedOrNull } from '../domain/salvage.ts';
import { resolveNote } from './note.ts';
import { BRIEFING_LIMITS, type Briefing, type BriefingItem } from './types.ts';

const ORDINAL_REFERENCE =
  /\b(?:item|entry|number|decision|task)\s+(?:#?\d+|one|two|three|four|five)\b|\b(?:first|second|third|fourth|last)\s+(?:one|item|entry|decision)\b/i;

const MERGE_CLAIM =
  /\b(?:ready to merge|ready for merging|mergeable|can be merged|merge it|safe to merge)\b/i;

function listQueueTaskIds(queue: Queue) {
  return [
    ...queue.ready.map((entry) => entry.task.id),
    ...queue.working.map((task) => task.id),
    ...queue.waiting.map((task) => task.id),
  ].map((id) => id.toLowerCase());
}

function cleanSentence(value: string | null, limit: number, ids: string[]) {
  if (value === null) return null;
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

function cleanWhy(value: string | null, entry: QueuedGate, ids: string[]) {
  const text = cleanSentence(value, BRIEFING_LIMITS.why, ids)?.replace(/\.$/, '');
  if (!text) return null;
  if (entry.gate.type !== 'merge' && MERGE_CLAIM.test(text)) return null;
  if (text.toLowerCase().startsWith(entry.task.title.toLowerCase())) return null;
  return text;
}

const BriefingPick = Schema.Struct({
  task: Schema.optionalKey(Schema.Unknown),
  task_id: Schema.optionalKey(Schema.Unknown),
  taskId: Schema.optionalKey(Schema.Unknown),
  why: SalvagedOrNull(Schema.String),
});

type BriefingPick = typeof BriefingPick.Type;

const BriefingAnswer = Schema.Struct({
  now: SalvagedOrNull(BriefingPick),
  next: SalvagedItems(BriefingPick),
  note: Salvaged(Schema.UndefinedOr(Schema.NullOr(Schema.String)), () => undefined),
});

const decodeBriefingAnswer = Schema.decodeUnknownOption(BriefingAnswer);

function resolvePickedTask(pick: BriefingPick | null) {
  const id = [pick?.task, pick?.task_id, pick?.taskId].find((field) => field !== undefined && field !== null);
  return Predicate.isString(id) ? id.trim() : null;
}

function isLow(entry: QueuedGate | undefined) {
  return entry?.task.priority === 'low';
}

function parseNext(picks: BriefingPick[], entries: Map<string, QueuedGate>, nowId: string, ids: string[]) {
  const picked = new Set([nowId]);
  const next: BriefingItem[] = [];
  for (const item of picks) {
    const id = resolvePickedTask(item);
    const entry = id === null ? undefined : entries.get(id);
    if (!entry || picked.has(entry.task.id) || next.length >= BRIEFING_LIMITS.next) continue;
    picked.add(entry.task.id);
    next.push({
      taskId: entry.task.id,
      why: cleanWhy(item.why, entry, ids) ?? resolveBriefingWhy(entry),
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

function parseNote(raw: string | null | undefined, queue: Queue, named: Set<string>, now: number, ids: string[]) {
  if (raw === null) return null;
  const written = cleanSentence(raw ?? null, BRIEFING_LIMITS.note, ids);
  if (written === null) return resolveFallbackNote(queue, named, now);
  return resolveNote(written, queue, named, now);
}

export function parseBriefing(raw: unknown, queue: Queue, now: number): Briefing | null {
  const decoded = decodeBriefingAnswer(raw);
  if (Option.isNone(decoded)) return null;
  const answer = decoded.value;
  const fallback = resolveFallbackBriefing(queue, now);
  const entries = new Map(listBriefingEntries(queue).map((entry) => [entry.task.id, entry]));
  if (entries.size === 0) return fallback;

  const nowId = resolvePickedTask(answer.now);
  const nowEntry = nowId === null ? undefined : entries.get(nowId);
  if (!nowEntry) return null;
  if (isLow(nowEntry) && [...entries.values()].some((entry) => !isLow(entry))) return null;

  const ids = listQueueTaskIds(queue);
  const next = parseNext(answer.next, entries, nowEntry.task.id, ids);
  const nowItem = {
    taskId: nowEntry.task.id,
    why: cleanWhy(answer.now?.why ?? null, nowEntry, ids) ?? resolveBriefingWhy(nowEntry),
  };
  const note = parseNote(answer.note, queue, listNamedIds(nowItem, next), now, ids);
  return { now: nowItem, next, running: fallback.running, note };
}
