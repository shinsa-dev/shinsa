import { Chunk, MergeView, uncollapseUnchanged } from '@codemirror/merge';
import { EditorState, type Extension, type StateEffect, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { COLLAPSE } from '@/lib/code/collapse.ts';
import { listHiddenSpans } from './collapsed.ts';
import { DIFF_CONFIG } from './unified.ts';

export interface SplitSides {
  a: Extension;
  b: Extension;
}

export interface SplitPair {
  a: EditorState;
  b: EditorState;
  chunks: readonly Chunk[];
  scroll: StateEffect<unknown> | null;
}

const LINE_BREAK = /\r\n?|\n/;

const SPLIT_THEME = EditorView.theme({
  '&': { height: 'auto' },
  '.cm-scroller': { overflowX: 'auto', overflowY: 'hidden' },
});

export function mapToOriginal(chunks: readonly Chunk[], position: number) {
  let ours = 0;
  let theirs = 0;
  for (const chunk of chunks) {
    if (chunk.fromB >= position) break;
    ours = chunk.toB;
    theirs = chunk.toA;
  }
  return theirs + Math.max(0, position - ours);
}

function listFoldStarts(view: EditorView, positions: readonly number[]) {
  const starts = listHiddenSpans(view.state)
    .filter((span) => positions.some((position) => span.from <= position && position <= span.to))
    .map((span) => span.from);
  return [...new Set(starts)].map((start) => uncollapseUnchanged.of(start));
}

export function revealSplitLines(merge: Pick<MergeView, 'a' | 'b' | 'chunks'>, lines: readonly number[]) {
  const doc = merge.b.state.doc;
  const positions = lines.filter((line) => line >= 1 && line <= doc.lines).map((line) => doc.line(line).from);
  const b = listFoldStarts(merge.b, positions);
  if (b.length === 0) return;
  const a = listFoldStarts(
    merge.a,
    positions.map((position) => mapToOriginal(merge.chunks, position))
  );
  merge.b.dispatch({ effects: b });
  if (a.length > 0) merge.a.dispatch({ effects: a });
}

export function findConfigBase(state: EditorState): Extension {
  const config: unknown = Reflect.get(state, 'config');
  const base: unknown = typeof config === 'object' && config !== null ? Reflect.get(config, 'base') : null;
  if (!Array.isArray(base)) throw new Error('CodeMirror no longer keeps a state’s extensions on its config.');
  return base;
}

export class SplitView {
  readonly merge: MergeView;
  readonly #base: SplitSides;
  #anchor: StateEffect<unknown> | null = null;
  #top = 0;
  #left = { a: 0, b: 0 };

  constructor() {
    const merge = new MergeView({
      a: { doc: '' },
      b: { doc: '' },
      collapseUnchanged: { margin: COLLAPSE.margin, minSize: COLLAPSE.minSize },
      diffConfig: DIFF_CONFIG,
      gutter: false,
    });
    merge.dom.style.height = '100%';
    merge.dom.style.overflow = 'auto';
    this.merge = merge;
    this.#base = { a: findConfigBase(merge.a.state), b: findConfigBase(merge.b.state) };
    merge.dom.addEventListener('scroll', () => this.#readScroll(), { passive: true });
    for (const side of ['a', 'b'] as const) {
      const scroller = merge[side].scrollDOM;
      scroller.addEventListener(
        'scroll',
        () => {
          this.#left[side] = scroller.scrollLeft;
        },
        { passive: true }
      );
    }
  }

  createPair(original: string, content: string, sides: SplitSides): SplitPair {
    const a = Text.of(original.split(LINE_BREAK));
    const b = Text.of(content.split(LINE_BREAK));
    const chunks = Chunk.build(a, b, DIFF_CONFIG);
    const shown = this.merge.chunks;
    this.merge.chunks = chunks;
    try {
      return {
        a: EditorState.create({ doc: a, extensions: [sides.a, SPLIT_THEME, this.#base.a] }),
        b: EditorState.create({ doc: b, extensions: [sides.b, SPLIT_THEME, this.#base.b] }),
        chunks,
        scroll: null,
      };
    } finally {
      this.merge.chunks = shown;
    }
  }

  show(pair: SplitPair) {
    const merge = this.merge;
    merge.chunks = pair.chunks;
    merge.a.setState(pair.a);
    merge.b.setState(pair.b);
    for (const side of ['a', 'b'] as const) {
      if (this.#left[side] !== 0) merge[side].scrollDOM.scrollLeft = 0;
      this.#left[side] = 0;
    }
    this.#anchor = pair.scroll;
    if (pair.scroll) merge.b.dispatch({ effects: pair.scroll });
    else if (this.#top !== 0) merge.dom.scrollTop = 0;
    merge.reconfigure({});
  }

  remember(pair: SplitPair) {
    const merge = this.merge;
    pair.a = merge.a.state;
    pair.b = merge.b.state;
    pair.chunks = merge.chunks;
    pair.scroll = this.#anchor;
  }

  #readScroll() {
    const merge = this.merge;
    this.#top = merge.dom.scrollTop;
    if (this.#top <= 0) {
      this.#anchor = null;
      return;
    }
    const top = merge.dom.getBoundingClientRect().top - merge.b.documentTop;
    const block = merge.b.lineBlockAtHeight(top);
    this.#anchor = EditorView.scrollIntoView(block.from, { y: 'start', yMargin: block.top - top });
  }
}
