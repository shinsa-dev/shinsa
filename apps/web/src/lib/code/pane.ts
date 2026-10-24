import type { FileContent } from '@shinsa/core';
import type { CodeNote, CodeSpotMark } from '@/lib/code/notes.ts';
import type { Loaded } from '@/lib/connection/code.ts';

export type PaneContent =
  | { kind: 'waiting' }
  | { kind: 'failed'; message: string }
  | { kind: 'absent'; head: FileContent | null }
  | { kind: 'text'; content: string; original: string | null };

function readText(loaded: Loaded<FileContent>, path: string | null) {
  if (path === null) return '';
  return loaded.status === 'ready' ? loaded.value.content : null;
}

function isPending(loaded: Loaded<FileContent>, path: string | null) {
  return path !== null && (loaded.status === 'loading' || loaded.status === 'idle');
}

export function resolvePaneContent(input: {
  headPath: string | null;
  basePath: string | null;
  diffing: boolean;
  head: Loaded<FileContent>;
  base: Loaded<FileContent>;
}): PaneContent {
  const { head, base, diffing } = input;
  if (isPending(head, input.headPath) || (diffing && isPending(base, input.basePath)))
    return { kind: 'waiting' };
  if (head.status === 'error') return { kind: 'failed', message: head.message };
  if (diffing && base.status === 'error') return { kind: 'failed', message: base.message };
  const content = readText(head, input.headPath);
  const original = diffing ? readText(base, input.basePath) : null;
  if (content === null || (diffing && original === null)) {
    return { kind: 'absent', head: head.status === 'ready' ? head.value : null };
  }
  return { kind: 'text', content, original };
}

export function listKeptLines(
  notes: readonly CodeNote[],
  spots: readonly CodeSpotMark[],
  line: number | null,
  end: number | null
) {
  return [
    ...notes.filter((note) => note.side === 'new').map((note) => note.line),
    ...spots.flatMap((spot) => [spot.from, spot.to]),
    ...(line ? [line, end ?? line] : []),
  ];
}
