import { describe, expect, it, mock } from 'bun:test';
import { listEditorCommands } from '@/lib/command/editor.ts';

describe('listEditorCommands', () => {
  it('lists the editor commands with their keys, leaving find and go to line to the Code section', () => {
    const run = mock((_id: string) => {});
    const section = listEditorCommands({ taskId: 't1', mac: true, readOnly: null, run });
    expect(section.heading).toBe('Editor');
    const labels = section.commands.map((item) => [item.label, item.trailing, item.disabled]);
    expect(labels.slice(0, 3)).toEqual([
      ['Save the file', '⌘S', undefined],
      ['Undo', '⌘Z', undefined],
      ['Redo', '⇧⌘Z', undefined],
    ]);
    expect(labels.some(([label]) => label === 'Find in this file' || label === 'Go to line')).toBe(false);
    const command = section.commands.find((item) => item.id === 'task.t1.editor.comment');
    if (command?.kind === 'run') command.run();
    expect(run.mock.calls).toEqual([['comment']]);
  });

  it('turns off the commands that edit while the file is read-only, with the reason, on any system', () => {
    const reason = 'This is an earlier commit, so it is read-only. Pick Head of the branch to edit.';
    const section = listEditorCommands({ taskId: 't1', mac: false, readOnly: reason, run: () => {} });
    const byId = new Map(section.commands.map((command) => [command.id.split('.').at(-1), command]));
    expect(byId.get('undo')).toMatchObject({ disabled: reason, trailing: 'Ctrl+Z' });
    expect(byId.get('add-next')).toMatchObject({ disabled: undefined, trailing: 'Ctrl+D' });
  });
});
