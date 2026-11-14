import { describe, expect, it, mock } from 'bun:test';
import { type CodeCommandContext, listCodeCommands } from '@/lib/command/code.ts';

function context(overrides: Partial<CodeCommandContext> = {}): CodeCommandContext {
  return {
    taskId: 't1',
    modes: ['changes', 'files'],
    mode: 'changes',
    mac: true,
    split: false,
    hideViewed: false,
    side: 'left',
    hasEditor: true,
    applyMode: mock(() => {}),
    copyPath: mock(() => {}),
    showInFiles: mock(() => {}),
    openInEditor: mock(() => {}),
    preview: null,
    togglePreview: mock(() => {}),
    run: mock(() => {}),
    toggleSplit: mock(() => {}),
    toggleHideViewed: mock(() => {}),
    toggleSide: mock(() => {}),
    ...overrides,
  };
}

describe('listCodeCommands', () => {
  it('offers the modes, then going to a file, searching, hiding viewed files, finding, a line and the diff layout', () => {
    const section = listCodeCommands(context());
    expect(section.heading).toBe('Code');
    expect(
      section.commands.map((command) => [command.label, command.trailing ?? null, command.current ?? null])
    ).toEqual([
      ['Changes', null, true],
      ['Files', null, false],
      ['Go to file…', '⌘P', null],
      ['Search in files', '⇧⌘F', null],
      ['Move the file list to the right', null, null],
      ['Hide viewed files', null, null],
      ['Find in this file', '⌘F', null],
      ['Go to line', '⌘G', null],
      ['Show diffs side by side', null, null],
      ['Copy path', null, null],
      ['Show in Files', null, null],
      ['Open in editor', null, null],
    ]);
  });

  it('runs what it names', () => {
    const value = context({ split: true, hideViewed: true, mac: false, side: 'right' });
    const section = listCodeCommands(value);
    for (const command of section.commands) if (command.kind === 'run') command.run();
    expect((value.applyMode as ReturnType<typeof mock>).mock.calls).toEqual([['changes'], ['files']]);
    expect((value.run as ReturnType<typeof mock>).mock.calls).toEqual([
      ['quick-open'],
      ['search'],
      ['find'],
      ['goto-line'],
    ]);
    expect(value.toggleSplit).toHaveBeenCalledTimes(1);
    expect(value.toggleHideViewed).toHaveBeenCalledTimes(1);
    expect(value.toggleSide).toHaveBeenCalledTimes(1);
    expect(value.copyPath).toHaveBeenCalledTimes(1);
    expect(value.showInFiles).toHaveBeenCalledTimes(1);
    expect(value.openInEditor).toHaveBeenCalledTimes(1);
    expect(section.commands.find((command) => command.id.endsWith('.side'))?.label).toBe(
      'Move the file list to the left'
    );
    expect(section.commands.find((command) => command.id.endsWith('.hide-viewed'))).toMatchObject({
      label: 'Show viewed files',
      icon: 'IconEyeSlash',
    });
    expect(section.commands.find((command) => command.id.endsWith('.split'))?.label).toBe(
      'Show diffs unified'
    );
    expect(section.commands.find((command) => command.label === 'Go to file…')?.trailing).toBe('Ctrl+P');
  });

  it('toggles the Markdown preview of an open Markdown file', () => {
    const shown = context({ preview: true });
    const command = listCodeCommands(shown).commands.find((entry) => entry.id.endsWith('.preview'));
    expect(command).toMatchObject({ label: 'Show source', icon: 'IconCode' });
    if (command?.kind === 'run') command.run();
    expect(shown.togglePreview).toHaveBeenCalledTimes(1);
    expect(
      listCodeCommands(context({ preview: false })).commands.find((entry) => entry.id.endsWith('.preview'))
    ).toMatchObject({ label: 'Show preview', icon: 'IconEyeOpen' });
    expect(listCodeCommands(context()).commands.some((entry) => entry.id.endsWith('.preview'))).toBe(false);
  });

  it('leaves out what needs an open file', () => {
    expect(
      listCodeCommands(
        context({ hasEditor: false, modes: ['files'], copyPath: null, showInFiles: null, openInEditor: null })
      ).commands.map((command) => command.label)
    ).toEqual(['Files', 'Go to file…', 'Search in files', 'Move the file list to the right']);
  });
});
