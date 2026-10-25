import { describe, expect, it, mock } from 'bun:test';
import { foldedRanges } from '@codemirror/language';
import { EditorSelection, Prec } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import {
  createEditorKeymap,
  describeEditorKey,
  EDITOR_COMMANDS,
  type EditorActions,
  selectEditorCommand,
  shrinkSelection,
} from '@/lib/code/editor/commands.ts';
import { requestLanguage } from '@/lib/code/editor/language.ts';
import { resolveEditable } from '@/lib/code/editor/setup.ts';
import { createView } from './support.ts';

const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function actions(): EditorActions & { save: ReturnType<typeof mock>; openFind: ReturnType<typeof mock> } {
  return { save: mock(() => {}), openFind: mock(() => {}) };
}

function run(view: EditorView, id: string, given: EditorActions = actions()) {
  const command = selectEditorCommand(id);
  if (!command) throw new Error(`No command ${id}`);
  return command.run(view, given);
}

const typescript = await requestLanguage('a.ts');

function editable(doc: string, selection?: EditorSelection) {
  const view = createView(doc, [Prec.highest(resolveEditable(true)), typescript ?? []]);
  if (selection) view.dispatch({ selection });
  return view;
}

function press(view: EditorView, key: string, modifiers: Partial<KeyboardEventInit> = {}) {
  return runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...modifiers }), 'editor');
}

const MOD = MAC ? { metaKey: true } : { ctrlKey: true };

describe('the editor commands', () => {
  it('have VS Code keys, each described for the Mac and for other systems', () => {
    expect(EDITOR_COMMANDS.map((command) => [command.id, describeEditorKey(command.keys[0], true)])).toEqual([
      ['save', '⌘S'],
      ['undo', '⌘Z'],
      ['redo', '⇧⌘Z'],
      ['find', '⌘F'],
      ['replace', '⌥⌘F'],
      ['goto-line', '⌃G'],
      ['add-next', '⌘D'],
      ['select-matches', '⇧⌘L'],
      ['cursor-above', '⌥⌘↑'],
      ['cursor-below', '⌥⌘↓'],
      ['move-up', '⌥↑'],
      ['move-down', '⌥↓'],
      ['copy-up', '⌥⇧↑'],
      ['copy-down', '⌥⇧↓'],
      ['delete-line', '⇧⌘K'],
      ['indent', '⌘]'],
      ['outdent', '⌘['],
      ['comment', '⌘/'],
      ['select-line', '⌘L'],
      ['expand', '⌃⇧⌘→'],
      ['shrink', '⌃⇧⌘←'],
      ['fold', '⌥⌘['],
      ['unfold', '⌥⌘]'],
      ['fold-all', '⌃⌥['],
      ['unfold-all', '⌃⌥]'],
    ]);
    expect(describeEditorKey({ key: 'Ctrl-h', mac: 'Mod-Alt-f' }, false)).toBe('Ctrl+H');
    expect(describeEditorKey({ key: 'Mod-Shift-k' }, false)).toBe('Ctrl+Shift+K');
    expect(describeEditorKey({ key: 'Shift-Alt-ArrowLeft' }, false)).toBe('Shift+Alt+Left');
    expect(describeEditorKey({ key: 'Mod-Meta-Enter' }, true)).toBe('⌘⌘Enter');
    expect(describeEditorKey({ key: 'Hyper-x' }, true)).toBe('HyperX');
    expect(selectEditorCommand('nothing')).toBeNull();
  });

  it('saves, finds and replaces through the page', () => {
    const given = actions();
    const view = editable('a');
    expect(run(view, 'save', given)).toBe(true);
    expect(run(view, 'find', given)).toBe(true);
    expect(run(view, 'replace', given)).toBe(true);
    expect(given.save).toHaveBeenCalledTimes(1);
    expect(given.openFind.mock.calls).toEqual([
      [view, false],
      [view, true],
    ]);
  });

  it('undoes and redoes', () => {
    const view = editable('a');
    view.dispatch({ changes: { from: 1, insert: 'b' }, userEvent: 'input.type' });
    run(view, 'undo');
    expect(view.state.doc.toString()).toBe('a');
    run(view, 'redo');
    expect(view.state.doc.toString()).toBe('ab');
  });

  it('adds the next occurrence, every occurrence, and cursors above and below', () => {
    const view = editable('cat\ncat\ncat', EditorSelection.single(0, 3));
    run(view, 'add-next');
    expect(view.state.selection.ranges).toHaveLength(2);
    view.dispatch({ selection: EditorSelection.single(0, 3) });
    run(view, 'select-matches');
    expect(view.state.selection.ranges).toHaveLength(3);
    view.dispatch({ selection: EditorSelection.single(5) });
    run(view, 'cursor-above');
    expect(view.state.selection.ranges).toHaveLength(2);
    view.dispatch({ selection: EditorSelection.single(5) });
    run(view, 'cursor-below');
    expect(view.state.selection.ranges).toHaveLength(2);
  });

  it('moves, copies and deletes lines, indents, outdents and comments', () => {
    const view = editable('a\nb', EditorSelection.single(2));
    run(view, 'move-up');
    expect(view.state.doc.toString()).toBe('b\na');
    run(view, 'move-down');
    expect(view.state.doc.toString()).toBe('a\nb');
    run(view, 'copy-down');
    expect(view.state.doc.toString()).toBe('a\nb\nb');
    run(view, 'copy-up');
    expect(view.state.doc.toString()).toBe('a\nb\nb\nb');
    run(view, 'delete-line');
    expect(view.state.doc.toString()).toBe('a\nb\nb');
    view.dispatch({ selection: EditorSelection.single(0) });
    run(view, 'indent');
    expect(view.state.doc.line(1).text).toMatch(/^\s+a$/);
    run(view, 'outdent');
    expect(view.state.doc.line(1).text).toBe('a');
    run(view, 'comment');
    expect(view.state.doc.line(1).text).toBe('// a');
    run(view, 'select-line');
    expect(view.state.selection.main.to).toBe(view.state.doc.line(2).from);
  });

  it('expands the selection by syntax and shrinks it back step by step', () => {
    const view = editable('f(g(x));', EditorSelection.single(4));
    expect(shrinkSelection(view)).toBe(false);
    run(view, 'expand');
    const first = view.state.selection.main;
    run(view, 'expand');
    expect(view.state.selection.main.to - view.state.selection.main.from).toBeGreaterThan(
      first.to - first.from
    );
    run(view, 'shrink');
    expect(view.state.selection.main.eq(first)).toBe(true);
    run(view, 'shrink');
    expect(view.state.selection.main.head).toBe(4);
    run(view, 'expand');
    view.dispatch({ selection: EditorSelection.single(0) });
    expect(shrinkSelection(view)).toBe(false);
  });

  it('folds and unfolds a block and every block, and goes to a line', () => {
    const view = editable('function a() {\n  return 1;\n}\n', EditorSelection.single(5));
    run(view, 'fold');
    expect(foldedRanges(view.state).size).toBe(1);
    run(view, 'unfold');
    expect(foldedRanges(view.state).size).toBe(0);
    run(view, 'fold-all');
    expect(foldedRanges(view.state).size).toBe(1);
    run(view, 'unfold-all');
    expect(foldedRanges(view.state).size).toBe(0);
    expect(run(view, 'goto-line')).toBe(true);
  });

  it('binds every key to its command with the page actions read at the time of the key', () => {
    const given = actions();
    const keymap = createEditorKeymap(() => given);
    expect(keymap.find((binding) => binding.key === 'Mod-s')?.preventDefault).toBe(true);
    const view = editable('a');
    keymap.find((binding) => binding.key === 'Mod-s')?.run?.(view);
    expect(given.save).toHaveBeenCalledTimes(1);
    expect(press(view, 'd', MOD)).toBe(true);
  });
});
