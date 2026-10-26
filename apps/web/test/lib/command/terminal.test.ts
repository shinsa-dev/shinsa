import { describe, expect, it, mock } from 'bun:test';
import type { Command } from '@/lib/command/registry.ts';
import { listTerminalPageCommands, type TerminalPageContext } from '@/lib/command/terminal.ts';
import { groupTerminalPlaces } from '@/lib/terminal/tabs.ts';
import { createTerminal, createTerminalState } from '../../support/terminals.ts';

const ONE = createTerminal({ id: 'one', name: 'Server' });
const TWO = createTerminal({ id: 'two', title: 'fish' });

const HOME = { path: '/Users/you', label: 'Home folder', kind: 'folder', taskId: null } as const;

function createContext(overrides: Partial<TerminalPageContext> = {}): TerminalPageContext {
  return {
    terminals: [ONE, TWO],
    active: ONE,
    groups: groupTerminalPlaces(createTerminalState(), 'shop'),
    fallback: HOME,
    mac: true,
    actions: {
      open: mock(() => undefined),
      select: mock(() => undefined),
      find: mock(() => undefined),
      restart: mock(() => undefined),
      rename: mock(() => Promise.resolve(true)),
      close: mock(() => undefined),
    },
    ...overrides,
  };
}

function find(commands: Command[], id: string) {
  const command = commands.find((each) => each.id === id);
  if (!command) throw new Error(`No ${id}`);
  return command;
}

describe('listTerminalPageCommands', () => {
  it('leads with the terminal’s own commands and lists the other terminals after', () => {
    const [page, others] = listTerminalPageCommands(createContext());
    expect(page?.commands.map((command) => command.label)).toEqual([
      'New terminal…',
      'Find in the scrollback',
      'Rename this terminal…',
      'Close this terminal',
    ]);
    expect(others?.commands.map((command) => [command.label, command.hint])).toEqual([
      ['fish', '/Users/you/Developer/web'],
    ]);
  });

  it('opens a new terminal in a place picked from a page of the project’s places', () => {
    const context = createContext();
    const command = find(listTerminalPageCommands(context)[0]?.commands ?? [], 'terminal.new');
    if (command.kind !== 'page' || command.page.kind !== 'list') throw new Error('Not a list page');
    expect(command.page.sections.map((section) => section.heading)).toEqual([
      'Repositories',
      'Folders',
      'Task worktrees',
    ]);
    const first = command.page.sections[0]?.commands[0];
    if (first?.kind === 'run') first.run();
    expect(context.actions.open).toHaveBeenCalledWith(expect.objectContaining({ label: 'api' }));
  });

  it('opens one at once where there is one place, the home folder where there is none', () => {
    const context = createContext({ groups: [] });
    const command = find(listTerminalPageCommands(context)[0]?.commands ?? [], 'terminal.new');
    expect(command).toMatchObject({ kind: 'run', label: 'New terminal', hint: 'Home folder' });
    if (command.kind === 'run') command.run();
    expect(context.actions.open).toHaveBeenCalledWith(HOME);
    const none = listTerminalPageCommands(createContext({ groups: [], fallback: null }));
    expect(none[0]?.commands.some((each) => each.id === 'terminal.new')).toBe(false);
  });

  it('starts an ended shell again, renames, finds, closes and switches', async () => {
    const context = createContext({ active: { ...ONE, status: 'exited', exitCode: 1 } });
    const [page, others] = listTerminalPageCommands(context);
    const commands = page?.commands ?? [];
    for (const id of ['terminal.restart', 'terminal.find', 'terminal.close']) {
      const command = find(commands, id);
      if (command.kind === 'run') command.run();
    }
    expect(context.actions.restart).toHaveBeenCalled();
    expect(context.actions.find).toHaveBeenCalled();
    expect(context.actions.close).toHaveBeenCalled();
    expect(find(commands, 'terminal.find').trailing).toBe('⌘F');
    const rename = find(commands, 'terminal.rename');
    if (rename.kind === 'page' && rename.page.kind === 'compose') {
      expect(rename.page.prefill).toBe('Server');
      await rename.page.send('Dev server');
    }
    expect(context.actions.rename).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }), 'Dev server');
    const other = others?.commands[0];
    if (other?.kind === 'run') other.run();
    expect(context.actions.select).toHaveBeenCalledWith(TWO);
  });

  it('has only New terminal when no terminal is open', () => {
    const [page] = listTerminalPageCommands(createContext({ terminals: [], active: null }));
    expect(page?.commands.map((command) => command.id)).toEqual(['terminal.new']);
  });
});
