import { afterEach, describe, expect, it } from 'bun:test';
import { getChunks } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { findConfigBase, mapToOriginal, revealSplitLines, SplitView } from '@/lib/code/editor/merge.ts';

const views: SplitView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.merge.destroy();
  document.body.innerHTML = '';
});

function createSplit() {
  const split = new SplitView();
  views.push(split);
  document.body.appendChild(split.merge.dom);
  return split;
}

function listLines(count: number, changed: number) {
  return Array.from({ length: count }, (_, index) => (index === changed ? 'changed' : `line ${index}`)).join(
    '\n'
  );
}

const SIDES = { a: [], b: [] };

describe('findConfigBase', () => {
  it('reads the extensions a state was made from, and refuses a state without them', () => {
    const marker = EditorView.editorAttributes.of({ class: 'marked' });
    const state = EditorState.create({ extensions: [marker] });
    const copy = EditorState.create({ doc: 'x', extensions: findConfigBase(state) });
    expect(copy.facet(EditorView.editorAttributes)).toEqual(state.facet(EditorView.editorAttributes));
    expect(() => findConfigBase(Object.create(EditorState.prototype))).toThrow(
      'CodeMirror no longer keeps a state’s extensions on its config.'
    );
  });
});

describe('SplitView', () => {
  it('shows each pair in the same two editors, the old file left, with its changes and folds', () => {
    const split = createSplit();
    const { a, b } = split.merge;
    const first = split.createPair(listLines(30, 99), listLines(30, 15), SIDES);
    split.show(first);
    expect(split.merge.a).toBe(a);
    expect(split.merge.b).toBe(b);
    expect(a.state.doc.line(16).text).toBe('line 15');
    expect(b.state.doc.line(16).text).toBe('changed');
    expect(getChunks(b.state)?.chunks).toHaveLength(1);
    expect(getChunks(a.state)?.side).toBe('a');
    expect(split.merge.dom.querySelector('.cm-collapsedLines')?.textContent).toContain('12 unchanged lines');
    expect(split.merge.dom.querySelector('.cm-changedLine')).not.toBeNull();
    const second = split.createPair('same', 'same', SIDES);
    expect(split.merge.chunks).toBe(first.chunks);
    split.show(second);
    expect(getChunks(b.state)?.chunks).toHaveLength(0);
    expect(split.merge.chunks).toHaveLength(0);
  });

  it('keeps an edit and its changes, and returns to where each pair was scrolled', () => {
    const split = createSplit();
    const first = split.createPair(listLines(60, 99), listLines(60, 40), SIDES);
    split.show(first);
    split.merge.b.dispatch({ changes: { from: 0, insert: 'edited ' } });
    split.merge.dom.scrollTop = 300;
    split.merge.dom.dispatchEvent(new Event('scroll'));
    split.merge.a.scrollDOM.dispatchEvent(new Event('scroll'));
    split.remember(first);
    expect(first.scroll).not.toBeNull();
    expect(first.chunks).toHaveLength(2);
    const second = split.createPair('a', 'b', SIDES);
    split.show(second);
    split.merge.dom.scrollTop = 0;
    split.merge.dom.dispatchEvent(new Event('scroll'));
    split.remember(second);
    expect(second.scroll).toBeNull();
    split.show(first);
    expect(split.merge.b.state.doc.line(1).text).toBe('edited line 0');
    expect(split.merge.chunks).toBe(first.chunks);
    split.merge.dom.scrollTop = 120;
    split.merge.dom.dispatchEvent(new Event('scroll'));
    split.show(second);
    expect(split.merge.dom.scrollTop).toBe(0);
  });

  it('opens the folds holding the lines a note, a spot or a link needs, on both sides', () => {
    const split = createSplit();
    const pair = split.createPair(listLines(60, 5), listLines(60, 50), SIDES);
    split.show(pair);
    const folds = () => [...split.merge.dom.querySelectorAll('.cm-collapsedLines')].length;
    const before = folds();
    revealSplitLines(split.merge, [0, 999]);
    expect(folds()).toBe(before);
    revealSplitLines(split.merge, [30]);
    expect(folds()).toBeLessThan(before);
    expect(split.merge.b.state.doc.line(30).text).toBe('line 29');
  });
});

describe('mapToOriginal', () => {
  it('finds the old file’s position for an unchanged line of the new one', () => {
    const split = createSplit();
    const pair = split.createPair('a\nb\nc\nd', 'a\nx\ny\nc\nd', SIDES);
    expect(mapToOriginal(pair.chunks, 0)).toBe(0);
    expect(mapToOriginal(pair.chunks, 8)).toBe(6);
    expect(mapToOriginal([], 3)).toBe(3);
  });
});
