import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import {
  CODE_KEYMAP,
  gotoLine,
  isAddingCursor,
  isColumnSelection,
  openSearchPanel,
  resolveEditable,
} from '@/lib/code/editor/setup.ts';
import { CODE_THEME, codeHighlight } from '@/lib/code/editor/theme.ts';
import { createView } from './support.ts';

describe('the editor setup', () => {
  it('is read-only until a suggestion makes it editable', () => {
    expect(EditorState.create({ extensions: resolveEditable(false) }).readOnly).toBe(true);
    expect(EditorState.create({ extensions: resolveEditable(true) }).readOnly).toBe(false);
  });

  it('binds stepping through matches and closing the find bar, and opens find and go to line', () => {
    expect(CODE_KEYMAP.map((binding) => binding.key)).toEqual(['F3', 'Escape']);
    const view = createView('a\nb', []);
    expect(openSearchPanel(view)).toBe(true);
    expect(view.dom.querySelector('.cm-find')).not.toBeNull();
    gotoLine(view);
    expect(view.dom.querySelector('.cm-panel')).not.toBeNull();
  });

  it('adds a cursor on an Alt click and selects a column on Shift Alt, like VS Code', () => {
    expect(isAddingCursor({ altKey: true, shiftKey: false })).toBe(true);
    expect(isAddingCursor({ altKey: true, shiftKey: true })).toBe(false);
    expect(isColumnSelection({ altKey: true, shiftKey: true })).toBe(true);
    expect(isColumnSelection({ altKey: false, shiftKey: true })).toBe(false);
  });

  it('opens the find bar with the default actions when no page gave its own', () => {
    const view = createView('a', []);
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: mac, ctrlKey: !mac });
    expect(runScopeHandlers(view, event, 'editor')).toBe(true);
    const save = new KeyboardEvent('keydown', { key: 's', metaKey: mac, ctrlKey: !mac });
    expect(runScopeHandlers(view, save, 'editor')).toBe(true);
    expect(view.dom.querySelector('.cm-find')).not.toBeNull();
  });

  it('colours code from the Shinsa tokens', () => {
    expect(CODE_THEME).toHaveLength(2);
    expect(codeHighlight.module?.getRules()).toContain('var(--code-keyword)');
  });
});
