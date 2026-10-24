import { describe, expect, it } from 'bun:test';
import { resolveCodeRows } from '@/lib/code/diff.ts';
import type { Token } from '@/lib/code/highlight.ts';
import { FOCUS_CONTEXT, joinRemovedText, mapRowTokens, resolveFocusWindow } from '@/lib/code/rows.ts';

function numbered(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');
}

function tokenLine(content: string): Token[] {
  return [{ content, style: undefined }];
}

const PATCH = '@@ -1,3 +1,3 @@\n a\n-b\n-c\n+B\n';

describe('joinRemovedText', () => {
  it('joins the removed lines in order so they can be highlighted together', () => {
    expect(joinRemovedText(resolveCodeRows(PATCH, null))).toBe('b\nc');
    expect(joinRemovedText(resolveCodeRows('', 'a'))).toBe('');
  });
});

describe('mapRowTokens', () => {
  it('takes removed lines from the old text and the rest from the current file', () => {
    const rows = resolveCodeRows(PATCH, 'a\nB\n');
    const tokens = mapRowTokens(rows, [tokenLine('a'), tokenLine('B')], [tokenLine('b'), tokenLine('c')]);
    expect(tokens.map((line) => line?.[0]?.content)).toEqual(['a', 'b', 'c', 'B']);
  });

  it('leaves rows plain while highlighting is not ready', () => {
    const rows = resolveCodeRows(PATCH, 'a\nB\n');
    expect(mapRowTokens(rows, null, null)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('leaves a row without a current line plain', () => {
    const rows = [{ kind: 'context' as const, text: 'x', oldLine: 3, newLine: null }];
    expect(mapRowTokens(rows, [tokenLine('x')], null)).toEqual([undefined]);
  });
});

describe('resolveFocusWindow', () => {
  const content = numbered(100);
  const rows = resolveCodeRows('@@ -50,1 +50,1 @@\n-line 50\n+line 50\n', content);

  it('shows the focused lines with twelve lines of context on each side', () => {
    const window = resolveFocusWindow(rows, { start: 30, end: 32 }, { above: 0, below: 0 });
    expect(window).toEqual({ start: 29 - FOCUS_CONTEXT, end: 32 + FOCUS_CONTEXT });
    expect(rows[window.start]?.newLine).toBe(30 - FOCUS_CONTEXT);
    expect(rows[window.end - 1]?.newLine).toBe(32 + FOCUS_CONTEXT);
  });

  it('grows by the extra lines asked for above and below', () => {
    const window = resolveFocusWindow(rows, { start: 30, end: 32 }, { above: 5, below: 4 });
    expect(rows[window.start]?.newLine).toBe(30 - FOCUS_CONTEXT - 5);
    expect(rows[window.end - 1]?.newLine).toBe(32 + FOCUS_CONTEXT + 4);
  });

  it('stops at the first and last rows', () => {
    expect(resolveFocusWindow(rows, { start: 3, end: 98 }, { above: 0, below: 0 })).toEqual({
      start: 0,
      end: rows.length,
    });
    expect(resolveFocusWindow([], { start: 3, end: 4 }, { above: 0, below: 0 })).toEqual({
      start: 0,
      end: 0,
    });
  });

  it('never cuts off removed lines that sit just above the window', () => {
    const removal = resolveCodeRows('@@ -30,2 +30,1 @@\n-line 30\n line 31\n', numbered(100));
    const focusLine = 30 + FOCUS_CONTEXT;
    const window = resolveFocusWindow(removal, { start: focusLine, end: focusLine }, { above: 0, below: 0 });
    expect(removal[window.start]?.kind).toBe('remove');
    expect(removal[window.start]?.oldLine).toBe(30);
  });
});
