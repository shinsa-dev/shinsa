import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { codeFolding, type LanguageSupport } from '@codemirror/language';
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search';
import { type Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  type Panel,
  rectangularSelection,
} from '@codemirror/view';
import { commentGutter } from './annotations.ts';
import { createEditorKeymap, type EditorActions, selectionHistory } from './commands.ts';
import { CODE_THEME } from './theme.ts';

export const CODE_KEYMAP = [
  { key: 'F3', run: findNext, shift: findPrevious, scope: 'editor search-panel', preventDefault: true },
  { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
];

export interface EditorSetup {
  language: LanguageSupport | null;
  editable: Compartment;
  onLine: (line: number, view: EditorView) => boolean;
  findPanel: (view: EditorView) => Panel;
  actions?: () => EditorActions;
}

const DEFAULT_ACTIONS: EditorActions = {
  save: () => undefined,
  openFind: (view) => {
    openSearchPanel(view);
  },
};

export function isAddingCursor(event: Pick<MouseEvent, 'altKey' | 'shiftKey'>) {
  return event.altKey && !event.shiftKey;
}

export function isColumnSelection(event: Pick<MouseEvent, 'altKey' | 'shiftKey'>) {
  return event.altKey && event.shiftKey;
}

export function resolveEditable(editable: boolean): Extension {
  return [EditorState.readOnly.of(!editable), EditorView.editable.of(true)];
}

export function createEditorExtensions(setup: EditorSetup): Extension[] {
  const actions = setup.actions ?? (() => DEFAULT_ACTIONS);
  return [
    CODE_THEME,
    setup.language ?? [],
    highlightSpecialChars(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.clickAddsSelectionRange.of(isAddingCursor),
    rectangularSelection({ eventFilter: isColumnSelection }),
    history(),
    codeFolding(),
    selectionHistory,
    search({ top: true, createPanel: setup.findPanel }),
    highlightSelectionMatches(),
    keymap.of([
      ...createEditorKeymap(actions),
      ...CODE_KEYMAP,
      indentWithTab,
      ...historyKeymap,
      ...searchKeymap,
      ...defaultKeymap,
    ]),
    commentGutter(setup.onLine),
    setup.editable.of(resolveEditable(false)),
  ];
}

export { closeSearchPanel, findNext, findPrevious, gotoLine, openSearchPanel };
