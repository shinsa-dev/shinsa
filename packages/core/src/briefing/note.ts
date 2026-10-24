import type { Queue } from '../queue/types.ts';
import { resolveFallbackNote } from './fallback.ts';

const QUOTED = /[“"]([^”"]+)[”"]/g;

const MIN_QUOTED_MENTION = 12;

function normaliseMention(text: string) {
  return text
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function mentionsTask(note: string, title: string) {
  const text = normaliseMention(note);
  const name = normaliseMention(title);
  if (!name) return false;
  if (text.includes(name)) return true;
  return [...note.matchAll(QUOTED)]
    .map((match) => normaliseMention(match[1] ?? ''))
    .some((quoted) => quoted.length >= MIN_QUOTED_MENTION && name.includes(quoted));
}

function listForbiddenTitles(queue: Queue, named: Set<string>) {
  return queue.ready.filter((entry) => named.has(entry.task.id)).map((entry) => entry.task.title);
}

export function resolveNote(note: string | null, queue: Queue, named: Set<string>, now: number) {
  if (note === null) return null;
  const repeats = listForbiddenTitles(queue, named).some((title) => mentionsTask(note, title));
  return repeats ? resolveFallbackNote(queue, named, now) : note;
}
