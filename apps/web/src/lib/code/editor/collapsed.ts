import { EditorSelection, EditorState, type Extension, type Transaction } from '@codemirror/state';
import { type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

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

export function writeGutterWidth(view: Pick<EditorView, 'dom'>, width: number) {
  const value = `${width}px`;
  if (view.dom.style.getPropertyValue('--cm-gutter-width') !== value) {
    view.dom.style.setProperty('--cm-gutter-width', value);
  }
}

function measureGutterWidth(view: EditorView) {
  view.requestMeasure({
    key: 'shinsa-gutter-width',
    read: () => view.dom.querySelector<HTMLElement>('.cm-gutters')?.offsetWidth ?? 0,
    write: (width) => writeGutterWidth(view, width),
  });
}

export const pinBlocksToGutter: Extension = ViewPlugin.define((view) => {
  measureGutterWidth(view);
  return {
    update: (update: ViewUpdate) => {
      if (update.geometryChanged || update.viewportChanged) measureGutterWidth(update.view);
    },
  };
});
