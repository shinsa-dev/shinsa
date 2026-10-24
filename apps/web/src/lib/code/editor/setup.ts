import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import type { LanguageSupport } from '@codemirror/language';
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
} from '@codemirror/search';
import { type Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightSpecialChars, keymap } from '@codemirror/view';
import { commentGutter } from './annotations.ts';
import { CODE_THEME } from './theme.ts';

export const CODE_KEYMAP = [
  { key: 'Mod-f', run: openSearchPanel, scope: 'editor search-panel', preventDefault: true },
  { key: 'Mod-g', run: gotoLine, preventDefault: true },
  { key: 'F3', run: findNext, shift: findPrevious, scope: 'editor search-panel', preventDefault: true },
  { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
];

export interface EditorSetup {
  language: LanguageSupport | null;
  editable: Compartment;
  onLine: (line: number, view: EditorView) => boolean;
}

export function resolveEditable(editable: boolean): Extension {
  return [EditorState.readOnly.of(!editable), EditorView.editable.of(true)];
}

export function createEditorExtensions(setup: EditorSetup): Extension[] {
  return [
    CODE_THEME,
    setup.language ?? [],
    highlightSpecialChars(),
    drawSelection(),
    history(),
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of([...CODE_KEYMAP, ...historyKeymap, ...defaultKeymap]),
    commentGutter(setup.onLine),
    setup.editable.of(resolveEditable(false)),
  ];
}

export { gotoLine, openSearchPanel };
