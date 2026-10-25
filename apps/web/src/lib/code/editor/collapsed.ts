import { EditorSelection, EditorState, type Extension, type Transaction } from '@codemirror/state';
import { type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';

interface Span {
  from: number;
  to: number;
}

export function listHiddenSpans(state: EditorState): Span[] {
  const spans: Span[] = [];
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === 'function') continue;
    (source as DecorationSet).between(0, state.doc.length, (from, to, decoration) => {
      if (from < to && decoration.spec.block && decoration.spec.widget) spans.push({ from, to });
    });
  }
  return spans;
}

export function resolveSkippedCursor(spans: readonly Span[], head: number, previous: number, length: number) {
  const span = spans.find((candidate) => candidate.from <= head && head <= candidate.to);
  if (!span) return null;
  if (head >= previous) return span.to < length ? span.to + 1 : Math.max(span.from - 1, 0);
  return span.from > 0 ? span.from - 1 : Math.min(span.to + 1, length);
}

function skipHiddenLines(transaction: Transaction) {
  const selection = transaction.selection;
  if (!selection || transaction.docChanged || !selection.main.empty) return transaction;
  const start = transaction.startState;
  const target = resolveSkippedCursor(
    listHiddenSpans(start),
    selection.main.head,
    start.selection.main.head,
    start.doc.length
  );
  if (target === null) return transaction;
  return [transaction, { selection: EditorSelection.cursor(target), sequential: true }];
}

export const skipCollapsedLines: Extension = EditorState.transactionFilter.of(skipHiddenLines);

function writeScrollOffset(view: Pick<EditorView, 'dom' | 'scrollDOM'>) {
  view.dom.style.setProperty('--scroll-left', `${view.scrollDOM.scrollLeft}px`);
}

export const followHorizontalScroll: Extension = ViewPlugin.define((view) => {
  const onScroll = () => writeScrollOffset(view);
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
  return { destroy: () => view.scrollDOM.removeEventListener('scroll', onScroll) };
});
