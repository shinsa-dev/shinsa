import { Chunk } from '@codemirror/merge';
import {
  type Extension,
  type Range,
  StateEffect,
  StateField,
  Text,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  lineNumberWidgetMarker,
  WidgetType,
} from '@codemirror/view';
import { type Highlighter, highlightTree } from '@lezer/highlight';

type Tree = Parameters<typeof highlightTree>[0];

import { type LineRange, listCollapsedRanges, selectRangeAt } from '@/lib/code/collapse.ts';
import { type EditorAnnotations, SlotWidget, selectAnnotations } from './annotations.ts';
import type { SlotRegistry } from './slots.ts';

export const DIFF_CONFIG = { scanLimit: 500, timeout: 20 } as const;

export const MAX_PARSED_ORIGINAL = 100_000;

export interface UnifiedDiffOptions {
  original: string;
  tree: Tree | null;
  highlighter: Highlighter;
  registry: SlotRegistry;
  collapse: boolean;
  annotations: EditorAnnotations;
  onOldLine: (line: number) => void;
}

interface UnifiedState {
  a: Text;
  chunks: readonly Chunk[];
  expanded: ReadonlySet<number>;
  annotations: EditorAnnotations;
  collapsed: readonly LineRange[];
  decorations: DecorationSet;
}

export const revealLine = StateEffect.define<number>();

interface Segment {
  from: number;
  to: number;
  classes: string;
}

function listTokenRanges(tree: Tree | null, highlighter: Highlighter, from: number, to: number) {
  const ranges: Segment[] = [];
  if (!tree) return ranges;
  highlightTree(
    tree,
    highlighter,
    (start, end, classes) => ranges.push({ from: start, to: end, classes }),
    from,
    to
  );
  return ranges;
}

export function listLineSegments(
  text: string,
  offset: number,
  tokens: readonly Segment[],
  changes: readonly { from: number; to: number }[]
): Segment[] {
  const end = offset + text.length;
  const bounds = new Set([offset, end]);
  for (const range of [...tokens, ...changes]) {
    if (range.from > offset && range.from < end) bounds.add(range.from);
    if (range.to > offset && range.to < end) bounds.add(range.to);
  }
  const points = [...bounds].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (const [index, from] of points.slice(0, -1).entries()) {
    const to = points[index + 1] ?? end;
    const token = tokens.find((range) => range.from <= from && range.to >= to)?.classes ?? '';
    const changed = changes.some((range) => range.from <= from && range.to >= to);
    segments.push({ from, to, classes: [token, changed ? 'cm-deletedText' : ''].filter(Boolean).join(' ') });
  }
  return segments;
}

class DeletionWidget extends WidgetType {
  constructor(
    readonly chunk: Chunk,
    readonly a: Text,
    readonly tree: Tree | null,
    readonly highlighter: Highlighter
  ) {
    super();
  }

  get lines() {
    const first = this.a.lineAt(this.chunk.fromA).number;
    const last = this.a.lineAt(this.chunk.endA).number;
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }

  override eq(other: DeletionWidget) {
    return other.chunk === this.chunk && other.tree === this.tree;
  }

  toDOM() {
    const dom = document.createElement('div');
    dom.className = 'cm-deletedChunk';
    const changes = this.chunk.changes
      .filter((change) => change.toA > change.fromA)
      .map((change) => ({ from: this.chunk.fromA + change.fromA, to: this.chunk.fromA + change.toA }));
    for (const number of this.lines) {
      const line = this.a.line(number);
      const row = dom.appendChild(document.createElement('div'));
      row.className = 'cm-deletedLine';
      const tokens = listTokenRanges(this.tree, this.highlighter, line.from, line.to);
      for (const segment of listLineSegments(line.text, line.from, tokens, changes)) {
        const span = row.appendChild(document.createElement('span'));
        if (segment.classes) span.className = segment.classes;
        span.textContent = this.a.sliceString(segment.from, segment.to);
      }
      if (line.length === 0) row.appendChild(document.createElement('br'));
    }
    return dom;
  }
}

class OldLinesMarker extends GutterMarker {
  constructor(
    readonly lines: readonly number[],
    readonly onOldLine: (line: number) => void
  ) {
    super();
  }

  override eq(other: OldLinesMarker) {
    return other.lines.join() === this.lines.join();
  }

  override toDOM() {
    const dom = document.createElement('div');
    dom.className = 'cm-oldLines';
    for (const line of this.lines) {
      const number = dom.appendChild(document.createElement('div'));
      number.textContent = String(line);
      number.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onOldLine(line);
      });
    }
    return dom;
  }
}

class CollapsedWidget extends WidgetType {
  constructor(readonly range: LineRange) {
    super();
  }

  override eq(other: CollapsedWidget) {
    return other.range.from === this.range.from && other.range.to === this.range.to;
  }

  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'cm-collapsedLines';
    const count = this.range.to - this.range.from + 1;
    dom.textContent = `${count} unchanged ${count === 1 ? 'line' : 'lines'}`;
    dom.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ effects: revealLine.of(this.range.from) });
    });
    return dom;
  }

  override ignoreEvent(event: Event) {
    return event instanceof MouseEvent;
  }
}

function listVisibleRanges(doc: Text, chunks: readonly Chunk[], keep: readonly number[]): LineRange[] {
  const ranges = chunks.map((chunk) => ({
    from: doc.lineAt(Math.min(chunk.fromB, doc.length)).number,
    to: doc.lineAt(Math.min(Math.max(chunk.fromB, chunk.endB), doc.length)).number,
  }));
  return [...ranges, ...keep.map((line) => ({ from: line, to: line }))];
}

function selectChunkOfOldLine(a: Text, chunks: readonly Chunk[], line: number) {
  if (line < 1 || line > a.lines) return null;
  const position = a.line(line).from;
  return (
    chunks.find((chunk) => chunk.fromA < chunk.toA && chunk.fromA <= position && position <= chunk.endA) ??
    null
  );
}

function buildDecorations(
  doc: Text,
  value: Omit<UnifiedState, 'decorations'>,
  options: Pick<UnifiedDiffOptions, 'tree' | 'highlighter' | 'registry'>
) {
  const ranges: Range<Decoration>[] = [];
  for (const chunk of value.chunks) {
    const at = Math.min(chunk.fromB, doc.length);
    if (chunk.toA > chunk.fromA) {
      const widget = new DeletionWidget(chunk, value.a, options.tree, options.highlighter);
      ranges.push(Decoration.widget({ block: true, side: -2, widget }).range(doc.lineAt(at).from));
    }
    if (chunk.toB <= chunk.fromB) continue;
    const first = doc.lineAt(at).number;
    const last = doc.lineAt(Math.min(chunk.endB, doc.length)).number;
    for (let line = first; line <= last; line += 1) {
      ranges.push(Decoration.line({ class: 'cm-insertedLine' }).range(doc.line(line).from));
    }
    if (!chunk.precise || chunk.toA <= chunk.fromA) continue;
    for (const change of chunk.changes) {
      if (change.toB <= change.fromB) continue;
      ranges.push(
        Decoration.mark({ class: 'cm-insertedText' }).range(
          chunk.fromB + change.fromB,
          chunk.fromB + change.toB
        )
      );
    }
  }
  for (const note of value.annotations.oldNotes) {
    const chunk = selectChunkOfOldLine(value.a, value.chunks, note.line);
    if (!chunk) continue;
    const at = doc.lineAt(Math.min(chunk.fromB, doc.length)).from;
    ranges.push(
      Decoration.widget({ block: true, side: -1, widget: new SlotWidget(note.key, options.registry) }).range(
        at
      )
    );
  }
  for (const range of value.collapsed) {
    ranges.push(
      Decoration.replace({ block: true, widget: new CollapsedWidget(range) }).range(
        doc.line(range.from).from,
        doc.line(range.to).to
      )
    );
  }
  return Decoration.set(ranges, true);
}

function resolveCollapsed(
  doc: Text,
  chunks: readonly Chunk[],
  expanded: ReadonlySet<number>,
  keep: readonly number[],
  collapse: boolean
) {
  if (!collapse) return [];
  return listCollapsedRanges(doc.lines, listVisibleRanges(doc, chunks, keep), expanded);
}

export function unifiedDiff(options: UnifiedDiffOptions): Extension {
  const field = StateField.define<UnifiedState>({
    create(state) {
      const a = Text.of(options.original.split('\n'));
      const chunks = Chunk.build(a, state.doc, DIFF_CONFIG);
      const expanded = new Set<number>();
      const collapsed = resolveCollapsed(
        state.doc,
        chunks,
        expanded,
        options.annotations.keep,
        options.collapse
      );
      const value = { a, chunks, expanded, annotations: options.annotations, collapsed };
      return { ...value, decorations: buildDecorations(state.doc, value, options) };
    },
    update(value, transaction: Transaction) {
      const doc = transaction.state.doc;
      const chunks = transaction.docChanged
        ? Chunk.updateB(value.chunks, value.a, doc, transaction.changes, DIFF_CONFIG)
        : value.chunks;
      const annotations = selectAnnotations(transaction.effects) ?? value.annotations;
      const expanded = new Set(value.expanded);
      for (const effect of transaction.effects) {
        if (!effect.is(revealLine)) continue;
        const range = selectRangeAt(value.collapsed, effect.value);
        if (range) expanded.add(range.from);
      }
      const changed =
        chunks !== value.chunks || annotations !== value.annotations || expanded.size !== value.expanded.size;
      if (!changed) return value;
      const collapsed = resolveCollapsed(doc, chunks, expanded, annotations.keep, options.collapse);
      const next = { a: value.a, chunks, expanded, annotations, collapsed };
      return { ...next, decorations: buildDecorations(doc, next, options) };
    },
    provide: (state) => EditorView.decorations.from(state, (value) => value.decorations),
  });
  return [
    field,
    lineNumberWidgetMarker.of((_view, widget) =>
      widget instanceof DeletionWidget ? new OldLinesMarker(widget.lines, options.onOldLine) : null
    ),
  ];
}
