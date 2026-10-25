import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  copyLineUp,
  deleteLine,
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
  redo,
  selectLine,
  selectParentSyntax,
  toggleComment,
  undo,
} from '@codemirror/commands';
import { foldAll, foldCode, unfoldAll, unfoldCode } from '@codemirror/language';
import { gotoLine, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { type EditorSelection, StateEffect, StateField } from '@codemirror/state';
import type { EditorView, KeyBinding } from '@codemirror/view';
import type { IconName } from '@shinsa/ui/components/icon';

export interface EditorActions {
  save: () => void;
  openFind: (view: EditorView, replace: boolean) => void;
}

export interface EditorKey {
  key: string;
  mac?: string;
}

export interface EditorCommand {
  id: string;
  label: string;
  icon: IconName;
  keys: [EditorKey, ...EditorKey[]];
  edits: boolean;
  run: (view: EditorView, actions: EditorActions) => boolean;
}

const pushSelection = StateEffect.define<EditorSelection>();

const popSelection = StateEffect.define<null>();

export const selectionHistory = StateField.define<readonly EditorSelection[]>({
  create: () => [],
  update(stack, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(pushSelection)) return [...stack, effect.value];
      if (effect.is(popSelection)) return stack.slice(0, -1);
    }
    return transaction.selection || transaction.docChanged ? [] : stack;
  },
});

function expandSelection(view: EditorView) {
  const before = view.state.selection;
  return selectParentSyntax({
    state: view.state,
    dispatch: (transaction) =>
      view.dispatch({
        selection: transaction.selection,
        effects: pushSelection.of(before),
        userEvent: 'select',
        scrollIntoView: true,
      }),
  });
}

export function shrinkSelection(view: EditorView) {
  const previous = view.state.field(selectionHistory, false)?.at(-1);
  if (!previous) return false;
  view.dispatch({ selection: previous, effects: popSelection.of(null), userEvent: 'select' });
  return true;
}

export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  {
    id: 'save',
    label: 'Save the file',
    icon: 'IconFloppyDisk1',
    keys: [{ key: 'Mod-s' }],
    edits: true,
    run: (_view, actions) => {
      actions.save();
      return true;
    },
  },
  {
    id: 'undo',
    label: 'Undo',
    icon: 'IconArrowUndoUp',
    keys: [{ key: 'Mod-z' }],
    edits: true,
    run: (view) => undo(view),
  },
  {
    id: 'redo',
    label: 'Redo',
    icon: 'IconArrowRedoDown',
    keys: [{ key: 'Mod-Shift-z' }, { key: 'Mod-y' }],
    edits: true,
    run: (view) => redo(view),
  },
  {
    id: 'find',
    label: 'Find in this file',
    icon: 'IconPageSearch',
    keys: [{ key: 'Mod-f' }],
    edits: false,
    run: (view, actions) => {
      actions.openFind(view, false);
      return true;
    },
  },
  {
    id: 'replace',
    label: 'Replace in this file',
    icon: 'IconArrowsRepeat',
    keys: [{ key: 'Ctrl-h', mac: 'Mod-Alt-f' }],
    edits: true,
    run: (view, actions) => {
      actions.openFind(view, true);
      return true;
    },
  },
  {
    id: 'goto-line',
    label: 'Go to line',
    icon: 'IconHashtag',
    keys: [{ key: 'Ctrl-g' }, { key: 'Mod-g' }],
    edits: false,
    run: (view) => gotoLine(view),
  },
  {
    id: 'add-next',
    label: 'Add the next occurrence to the selection',
    icon: 'IconCursor',
    keys: [{ key: 'Mod-d' }],
    edits: false,
    run: (view) => selectNextOccurrence(view),
  },
  {
    id: 'select-matches',
    label: 'Select every occurrence',
    icon: 'IconCursorList',
    keys: [{ key: 'Mod-Shift-l' }],
    edits: false,
    run: (view) => selectSelectionMatches(view),
  },
  {
    id: 'cursor-above',
    label: 'Add a cursor above',
    icon: 'IconArrowUp',
    keys: [{ key: 'Ctrl-Alt-ArrowUp', mac: 'Mod-Alt-ArrowUp' }],
    edits: false,
    run: (view) => addCursorAbove(view),
  },
  {
    id: 'cursor-below',
    label: 'Add a cursor below',
    icon: 'IconArrowDown',
    keys: [{ key: 'Ctrl-Alt-ArrowDown', mac: 'Mod-Alt-ArrowDown' }],
    edits: false,
    run: (view) => addCursorBelow(view),
  },
  {
    id: 'move-up',
    label: 'Move the line up',
    icon: 'IconArrowUp',
    keys: [{ key: 'Alt-ArrowUp' }],
    edits: true,
    run: (view) => moveLineUp(view),
  },
  {
    id: 'move-down',
    label: 'Move the line down',
    icon: 'IconArrowDown',
    keys: [{ key: 'Alt-ArrowDown' }],
    edits: true,
    run: (view) => moveLineDown(view),
  },
  {
    id: 'copy-up',
    label: 'Copy the line up',
    icon: 'IconSquareBehindSquare2',
    keys: [{ key: 'Shift-Alt-ArrowUp' }],
    edits: true,
    run: (view) => copyLineUp(view),
  },
  {
    id: 'copy-down',
    label: 'Copy the line down',
    icon: 'IconSquareBehindSquare2',
    keys: [{ key: 'Shift-Alt-ArrowDown' }],
    edits: true,
    run: (view) => copyLineDown(view),
  },
  {
    id: 'delete-line',
    label: 'Delete the line',
    icon: 'IconTrashCan',
    keys: [{ key: 'Mod-Shift-k' }],
    edits: true,
    run: (view) => deleteLine(view),
  },
  {
    id: 'indent',
    label: 'Indent the line',
    icon: 'IconTextIndentRight',
    keys: [{ key: 'Mod-]' }],
    edits: true,
    run: (view) => indentMore(view),
  },
  {
    id: 'outdent',
    label: 'Outdent the line',
    icon: 'IconTextIndentLeft',
    keys: [{ key: 'Mod-[' }],
    edits: true,
    run: (view) => indentLess(view),
  },
  {
    id: 'comment',
    label: 'Toggle a line comment',
    icon: 'IconBubbleText',
    keys: [{ key: 'Mod-/' }],
    edits: true,
    run: (view) => toggleComment(view),
  },
  {
    id: 'select-line',
    label: 'Select the line',
    icon: 'IconTextSelect',
    keys: [{ key: 'Mod-l' }],
    edits: false,
    run: (view) => selectLine(view),
  },
  {
    id: 'expand',
    label: 'Expand the selection',
    icon: 'IconExpandSimple',
    keys: [{ key: 'Shift-Alt-ArrowRight', mac: 'Ctrl-Shift-Mod-ArrowRight' }],
    edits: false,
    run: expandSelection,
  },
  {
    id: 'shrink',
    label: 'Shrink the selection',
    icon: 'IconMinimize',
    keys: [{ key: 'Shift-Alt-ArrowLeft', mac: 'Ctrl-Shift-Mod-ArrowLeft' }],
    edits: false,
    run: shrinkSelection,
  },
  {
    id: 'fold',
    label: 'Fold the block',
    icon: 'IconArrowsHide',
    keys: [{ key: 'Ctrl-Shift-[', mac: 'Mod-Alt-[' }],
    edits: false,
    run: (view) => foldCode(view),
  },
  {
    id: 'unfold',
    label: 'Unfold the block',
    icon: 'IconArrowsShow',
    keys: [{ key: 'Ctrl-Shift-]', mac: 'Mod-Alt-]' }],
    edits: false,
    run: (view) => unfoldCode(view),
  },
  {
    id: 'fold-all',
    label: 'Fold every block',
    icon: 'IconArrowsHide',
    keys: [{ key: 'Ctrl-Alt-[' }],
    edits: false,
    run: (view) => foldAll(view),
  },
  {
    id: 'unfold-all',
    label: 'Unfold every block',
    icon: 'IconArrowsShow',
    keys: [{ key: 'Ctrl-Alt-]' }],
    edits: false,
    run: (view) => unfoldAll(view),
  },
];

export function selectEditorCommand(id: string) {
  return EDITOR_COMMANDS.find((command) => command.id === id) ?? null;
}

export function createEditorKeymap(actions: () => EditorActions): KeyBinding[] {
  return EDITOR_COMMANDS.flatMap((command) =>
    command.keys.map((binding) => ({
      key: binding.key,
      mac: binding.mac,
      run: (view: EditorView) => command.run(view, actions()),
      preventDefault: true,
    }))
  );
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘', Meta: '⌘' };

const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod', 'Meta'];

const KEY_NAMES: Record<string, { mac: string; other: string }> = {
  ArrowUp: { mac: '↑', other: 'Up' },
  ArrowDown: { mac: '↓', other: 'Down' },
  ArrowLeft: { mac: '←', other: 'Left' },
  ArrowRight: { mac: '→', other: 'Right' },
};

export function describeEditorKey(binding: EditorKey, mac: boolean) {
  const spec = mac ? (binding.mac ?? binding.key) : binding.key;
  const parts = spec.split(/-(?!$)/);
  const key = parts.pop() ?? '';
  const name = KEY_NAMES[key]?.[mac ? 'mac' : 'other'] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (mac) {
    const modifiers = [...parts].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return `${modifiers.map((modifier) => MAC_SYMBOLS[modifier] ?? modifier).join('')}${name}`;
  }
  return [...parts.map((modifier) => (modifier === 'Mod' ? 'Ctrl' : modifier)), name].join('+');
}
