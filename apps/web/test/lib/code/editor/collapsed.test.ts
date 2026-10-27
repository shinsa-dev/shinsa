import { describe, expect, it } from 'bun:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import {
  listHiddenSpans,
  pinBlocksToGutter,
  resolveSkippedCursor,
  skipCollapsedLines,
  writeGutterWidth,
} from '@/lib/code/editor/collapsed.ts';

class Fold extends WidgetType {
  toDOM() {
    return document.createElement('div');
  }
}

const DOC = ['a', 'b', 'c', 'd', 'e'].join('\n');

function createState() {
  const hidden = Decoration.set([Decoration.replace({ block: true, widget: new Fold() }).range(2, 5)]);
  const point = Decoration.set([Decoration.widget({ block: true, widget: new Fold() }).range(0)]);
  return EditorState.create({
    doc: DOC,
    extensions: [
      EditorView.decorations.of(hidden),
      EditorView.decorations.of(point),
      EditorView.decorations.of(() => hidden),
      skipCollapsedLines,
    ],
  });
}

describe('the cursor skips folded unchanged lines', () => {
  it('finds the folded lines, not widgets that sit between lines', () => {
    expect(listHiddenSpans(createState())).toEqual([{ from: 2, to: 5 }]);
  });

  it('moves past the fold in the direction you were going', () => {
    const spans = [{ from: 2, to: 5 }];
    expect(resolveSkippedCursor(spans, 2, 1, 9)).toBe(6);
    expect(resolveSkippedCursor(spans, 5, 7, 9)).toBe(1);
    expect(resolveSkippedCursor(spans, 7, 1, 9)).toBeNull();
    expect(resolveSkippedCursor([{ from: 0, to: 3 }], 2, 4, 9)).toBe(4);
    expect(resolveSkippedCursor([{ from: 6, to: 9 }], 7, 5, 9)).toBe(5);
  });

  it('applies to a moving cursor only, never to an edit or a selection', () => {
    const state = createState();
    expect(state.update({ selection: EditorSelection.cursor(3) }).state.selection.main.head).toBe(6);
    expect(state.update({ selection: EditorSelection.cursor(1) }).state.selection.main.head).toBe(1);
    expect(state.update({ selection: EditorSelection.range(0, 3) }).state.selection.main.head).toBe(3);
    expect(state.update({ changes: { from: 0, insert: 'x' } }).state.doc.toString()).toBe(`x${DOC}`);
  });
});

describe('folds and notes stay beside the gutter while the code scrolls sideways', () => {
  it('writes the gutter’s width for the sticky blocks, only when it changes', () => {
    const dom = document.createElement('div');
    const spy = { dom };
    writeGutterWidth(spy, 62);
    expect(dom.style.getPropertyValue('--cm-gutter-width')).toBe('62px');
    let writes = 0;
    const setProperty = dom.style.setProperty.bind(dom.style);
    dom.style.setProperty = (...args: Parameters<typeof setProperty>) => {
      writes += 1;
      setProperty(...args);
    };
    writeGutterWidth(spy, 62);
    writeGutterWidth(spy, 70);
    expect(writes).toBe(1);
    expect(dom.style.getPropertyValue('--cm-gutter-width')).toBe('70px');
  });

  it('measures the gutter when the editor opens and when its geometry changes', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: 'a', extensions: [pinBlocksToGutter] }),
      parent,
    });
    view.dispatch({ changes: { from: 1, insert: '\nb'.repeat(400) } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.dom.style.getPropertyValue('--cm-gutter-width')).toBe('0px');
    view.destroy();
    parent.remove();
  });
});
