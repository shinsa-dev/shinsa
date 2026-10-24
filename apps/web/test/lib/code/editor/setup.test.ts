import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { CODE_KEYMAP, gotoLine, openSearchPanel, resolveEditable } from '@/lib/code/editor/setup.ts';
import { CODE_THEME, codeHighlight } from '@/lib/code/editor/theme.ts';
import { createView } from './support.ts';

describe('the editor setup', () => {
  it('is read-only until a suggestion makes it editable', () => {
    expect(EditorState.create({ extensions: resolveEditable(false) }).readOnly).toBe(true);
    expect(EditorState.create({ extensions: resolveEditable(true) }).readOnly).toBe(false);
  });

  it('binds find and go to line, and opens both', () => {
    expect(CODE_KEYMAP.map((binding) => binding.key)).toEqual(['Mod-f', 'Mod-g', 'F3', 'Escape']);
    const view = createView('a\nb', []);
    expect(openSearchPanel(view)).toBe(true);
    expect(view.dom.querySelector('.cm-search')).not.toBeNull();
    gotoLine(view);
    expect(view.dom.querySelector('.cm-panel')).not.toBeNull();
  });

  it('colours code from the Shinsa tokens', () => {
    expect(CODE_THEME).toHaveLength(2);
    expect(codeHighlight.module?.getRules()).toContain('var(--code-keyword)');
  });
});
