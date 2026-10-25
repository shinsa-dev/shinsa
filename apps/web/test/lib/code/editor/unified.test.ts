import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { NO_ANNOTATIONS, setAnnotations } from '@/lib/code/editor/annotations.ts';
import { SlotRegistry } from '@/lib/code/editor/slots.ts';
import type { TokenSet } from '@/lib/code/editor/tokens.ts';
import {
  listLineSegments,
  listTokenRanges,
  revealLine,
  setOriginalTokens,
  unifiedDiff,
} from '@/lib/code/editor/unified.ts';
import { createView } from './support.ts';

const ORIGINAL = [
  '/* start',
  'old comment line',
  'end */',
  'const a = 1;',
  ...Array.from({ length: 20 }, (_, index) => `line ${index}`),
  'tail',
  '',
].join('\n');

const CURRENT = [
  '/* start',
  'end */',
  'const a = 2;',
  ...Array.from({ length: 20 }, (_, index) => `line ${index}`),
  'tail',
  'added',
  '',
].join('\n');

const COMMENT = 1;

const TOKENS: TokenSet = {
  classes: ['', 'tm-code-comment'],
  lines: ORIGINAL.split('\n').map((line, index) =>
    index < 3 ? Uint32Array.from([line.length, COMMENT]) : Uint32Array.from([line.length, 0])
  ),
};

function createDiff(
  onOldLine: (line: number) => void = () => {},
  annotations = NO_ANNOTATIONS,
  tokens: TokenSet | null = TOKENS
) {
  return createView(CURRENT, [
    unifiedDiff({
      original: ORIGINAL,
      tokens,
      registry: new SlotRegistry(),
      collapse: true,
      annotations,
      onOldLine,
    }),
  ]);
}

describe('unifiedDiff', () => {
  it('shows removed lines above where they were, coloured from the whole old file', () => {
    const view = createDiff();
    const removed = [...view.dom.querySelectorAll('.cm-deletedLine')].map((line) => line.textContent);
    expect(removed).toEqual(['old comment line', 'const a = 1;']);
    const comment = view.dom.querySelector('.cm-deletedLine span');
    expect(comment?.className).toContain('tm-code-comment');
    expect(view.dom.querySelectorAll('.cm-insertedLine').length).toBe(2);
    expect([...view.dom.querySelectorAll('.cm-insertedText')].map((text) => text.textContent)).toContain('2');
    expect([...view.dom.querySelectorAll('.cm-deletedText')].map((text) => text.textContent)).toContain('1');
  });

  it('folds long unchanged stretches and opens one on a click or a reveal', () => {
    const view = createDiff();
    const fold = view.dom.querySelector('.cm-collapsedLines');
    expect(fold?.textContent).toBe('15 unchanged lines');
    fold?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(view.dom.querySelector('.cm-collapsedLines')).toBeNull();
    const other = createDiff();
    other.dispatch({ effects: revealLine.of(10) });
    expect(other.dom.querySelector('.cm-collapsedLines')).toBeNull();
    other.dispatch({ effects: revealLine.of(1) });
  });

  it('keeps the lines a note sits on unfolded and draws notes on removed lines under them', () => {
    const view = createDiff(() => {}, {
      ...NO_ANNOTATIONS,
      keep: [12],
      oldNotes: [
        { key: 'old', line: 2 },
        { key: 'nowhere', line: 99 },
        { key: 'kept', line: 1 },
      ],
    });
    expect([...view.dom.querySelectorAll('.cm-collapsedLines')].map((fold) => fold.textContent)).toEqual([
      '6 unchanged lines',
    ]);
    expect(
      [...view.dom.querySelectorAll('.cm-note-slot')].map((slot) => (slot as HTMLElement).dataset.slot)
    ).toEqual(['old']);
    view.dispatch({ effects: setAnnotations.of(NO_ANNOTATIONS) });
    expect(view.dom.querySelectorAll('.cm-note-slot').length).toBe(0);
  });

  it('numbers the removed lines in the gutter, and a click there comments on that old line', () => {
    const lines: number[] = [];
    const view = createDiff((line) => lines.push(line));
    const numbers = [...view.dom.querySelectorAll('.cm-oldLines > div')];
    expect(numbers.map((number) => number.textContent)).toEqual(['2', '4']);
    numbers[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(lines).toEqual([2]);
  });

  it('follows an edit, so a suggestion still shows what it changes', () => {
    const view = createDiff();
    view.dispatch({ changes: { from: 0, insert: 'new first\n' } });
    expect(view.dom.querySelectorAll('.cm-insertedLine').length).toBe(3);
    view.dispatch({ selection: { anchor: 1 } });
  });

  it('works on a file with no grammar and without folding', () => {
    const state = EditorState.create({
      doc: 'b\n',
      extensions: unifiedDiff({
        original: 'a\n',
        tokens: null,
        registry: new SlotRegistry(),
        collapse: false,
        annotations: NO_ANNOTATIONS,
        onOldLine: () => {},
      }),
    });
    const parent = document.createElement('div');
    const view = new EditorView({ state, parent });
    expect(view.dom.querySelector('.cm-deletedLine')?.textContent).toBe('a');
    view.destroy();
    const empty = createView('x', [
      unifiedDiff({
        original: '',
        tokens: null,
        registry: new SlotRegistry(),
        collapse: false,
        annotations: NO_ANNOTATIONS,
        onOldLine: () => {},
      }),
    ]);
    expect(empty.dom.querySelectorAll('.cm-insertedLine').length).toBe(1);
    const blank = createView('', [
      unifiedDiff({
        original: '\n\nx',
        tokens: null,
        registry: new SlotRegistry(),
        collapse: false,
        annotations: NO_ANNOTATIONS,
        onOldLine: () => {},
      }),
    ]);
    expect(blank.dom.querySelectorAll('.cm-deletedLine br').length).toBe(2);
  });
});

describe('the old side tokens', () => {
  it('colours removed lines once their tokens arrive', () => {
    const view = createDiff(() => {}, NO_ANNOTATIONS, null);
    expect(view.dom.querySelector('.cm-deletedLine span')?.className).not.toContain('tm-code-comment');
    view.dispatch({ effects: setOriginalTokens.of(TOKENS) });
    expect(view.dom.querySelector('.cm-deletedLine span')?.className).toContain('tm-code-comment');
  });

  it('reads a line of tokens as classed ranges from where the line starts', () => {
    expect(listTokenRanges(null, 1, 0)).toEqual([]);
    expect(listTokenRanges({ classes: [''], lines: [] }, 1, 0)).toEqual([]);
    const tokens: TokenSet = { classes: ['', 'a', 'b'], lines: [Uint32Array.from([3, 1, 5, 0, 9, 2, 9, 1])] };
    expect(listTokenRanges(tokens, 1, 10)).toEqual([
      { from: 10, to: 13, classes: 'a' },
      { from: 15, to: 19, classes: 'b' },
    ]);
  });
});

describe('listLineSegments', () => {
  it('splits a line where a token or a change starts or ends', () => {
    expect(
      listLineSegments('abcdef', 10, [{ from: 10, to: 13, classes: 'kw' }], [{ from: 12, to: 14 }])
    ).toEqual([
      { from: 10, to: 12, classes: 'kw' },
      { from: 12, to: 13, classes: 'kw cm-deletedText' },
      { from: 13, to: 14, classes: 'cm-deletedText' },
      { from: 14, to: 16, classes: '' },
    ]);
  });
});
