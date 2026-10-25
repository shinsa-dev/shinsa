import { describe, expect, it } from 'bun:test';
import { foldable, foldedRanges } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  createChevronMarkers,
  createFolding,
  indentFolding,
  measureIndent,
  resolveIndentFold,
} from '@/lib/code/editor/folding.ts';
import { createView } from './support.ts';

const CODE = ['def a():', '    one', '', '\ttwo', 'b', '', 'c:', '    d'].join('\n');

describe('measureIndent', () => {
  it('counts spaces and tabs to the next stop, and calls a blank line blank', () => {
    expect(measureIndent('    x', 4)).toBe(4);
    expect(measureIndent('  \tx', 4)).toBe(4);
    expect(measureIndent('   ', 4)).toBe(-1);
  });
});

describe('resolveIndentFold', () => {
  it('folds what is indented under a line, over blank lines, like VS Code', () => {
    const state = EditorState.create({ doc: CODE });
    expect(resolveIndentFold(state, 0)).toEqual({ from: 8, to: state.doc.line(4).to });
    expect(resolveIndentFold(state, 0)).toEqual({ from: 8, to: state.doc.line(4).to });
    expect(resolveIndentFold(state, state.doc.line(5).from)).toBeNull();
    expect(resolveIndentFold(state, state.doc.line(3).from)).toBeNull();
    expect(resolveIndentFold(state, state.doc.line(7).from)).toEqual({
      from: state.doc.line(7).to,
      to: state.doc.length,
    });
  });

  it('serves CodeMirror as a fold service', () => {
    const state = EditorState.create({ doc: CODE, extensions: indentFolding });
    expect(foldable(state, 0, state.doc.line(1).to)).toEqual({ from: 8, to: state.doc.line(4).to });
  });
});

describe('createFolding', () => {
  it('draws chevrons from the page’s icon and the VS Code placeholder, which unfolds on a click', () => {
    const markers = createChevronMarkers(() => '<svg class="chevron"></svg>');
    expect(markers.create(true).className).toBe('cm-fold-open');
    expect(markers.create(false).querySelector('.chevron')).not.toBeNull();
    const view = createView(CODE, [indentFolding, createFolding(markers)]);
    const marker = view.dom.querySelector('.cm-fold-open');
    marker?.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const placeholder = view.dom.querySelector<HTMLElement>('.cm-foldPlaceholder');
    expect(placeholder?.textContent).toBe('⋯');
    expect(foldedRanges(view.state).size).toBe(1);
    placeholder?.click();
    expect(foldedRanges(view.state).size).toBe(0);
  });
});
