import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { COLLAPSE } from '@/lib/code/collapse.ts';
import { DIFF_CONFIG } from './unified.ts';

export function findFirstChangedLine(doc: Text, chunks: readonly Chunk[]) {
  const first = chunks[0];
  if (!first) return null;
  return doc.lineAt(Math.min(first.fromB, doc.length)).number;
}

export function listBaselineChunks(baseline: string, doc: Text) {
  return Chunk.build(Text.of(baseline.split('\n')), doc, DIFF_CONFIG);
}

export function resolveFirstChangeScroll(view: EditorView, scroller: HTMLElement, line: number) {
  const doc = view.state.doc;
  const number = Math.min(line, doc.lines);
  const offset = view.documentTop - scroller.getBoundingClientRect().top;
  const top = offset + view.lineBlockAt(doc.line(number).from).top;
  if (top >= 0 && top < scroller.clientHeight / 2) return null;
  const context = view.lineBlockAt(doc.line(Math.max(1, number - COLLAPSE.margin)).from);
  return Math.max(0, scroller.scrollTop + offset + context.top);
}

export function revealFirstChange(view: EditorView, scroller: HTMLElement, line: number) {
  view.requestMeasure({
    key: 'shinsa-first-change',
    read: () => resolveFirstChangeScroll(view, scroller, line),
    write: (scrollTop) => {
      if (scrollTop !== null) scroller.scrollTop = scrollTop;
    },
  });
}
