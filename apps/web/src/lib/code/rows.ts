import { type CodeRow, findRowIndex } from '@/lib/code/diff.ts';
import type { Token } from '@/lib/code/highlight.ts';

export const FOCUS_CONTEXT = 12;

export const MORE_ROWS = 30;

export function joinRemovedText(rows: CodeRow[]) {
  return rows
    .filter((row) => row.kind === 'remove')
    .map((row) => row.text)
    .join('\n');
}

export function mapRowTokens(rows: CodeRow[], current: Token[][] | null, removed: Token[][] | null) {
  let removedIndex = 0;
  return rows.map((row) => {
    if (row.kind === 'remove') {
      const tokens = removed?.[removedIndex];
      removedIndex += 1;
      return tokens;
    }
    return row.newLine === null ? undefined : current?.[row.newLine - 1];
  });
}

export function resolveFocusWindow(
  rows: CodeRow[],
  focus: { start: number; end: number },
  extra: { above: number; below: number }
) {
  let start = Math.max(0, findRowIndex(rows, focus.start) - FOCUS_CONTEXT - extra.above);
  while (start > 0 && rows[start - 1]?.kind === 'remove') start -= 1;
  const end = Math.min(rows.length, findRowIndex(rows, focus.end) + 1 + FOCUS_CONTEXT + extra.below);
  return { start, end };
}
