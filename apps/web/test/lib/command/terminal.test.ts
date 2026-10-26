import { describe, expect, it, mock } from 'bun:test';
import { resolveServiceView } from '@shinsa/core';
import type { Command } from '@/lib/command/registry.ts';
import {
  listServiceCommands,
  listTerminalPageCommands,
  type TerminalPageContext,
} from '@/lib/command/terminal.ts';
import { groupTerminalPlaces } from '@/lib/terminal/tabs.ts';
import { NOW } from '../../support/state.ts';
import { createService, createTerminal, createTerminalState } from '../../support/terminals.ts';

const ONE = createTerminal({ id: 'one', name: 'Server' });
const TWO = createTerminal({ id: 'two', title: 'fish' });

const HOME = { path: '/Users/you', label: 'Home folder', kind: 'folder', taskId: null } as const;

function createContext(overrides: Partial<TerminalPageContext> = {}): TerminalPageContext {
  return {
    terminals: [ONE, TWO],
    services: [],
    active: ONE,
    activeService: null,
    groups: groupTerminalPlaces(createTerminalState(), 'shop'),
    fallback: HOME,
    mac: true,
    actions: {
      open: mock(() => undefined),
      select: mock(() => undefined),
      find: mock(() => undefined),
      clear: mock(() => undefined),
      restart: mock(() => undefined),
      rename: mock(() => Promise.resolve(true)),
      close: mock(() => undefined),
      startService: mock(() => undefined),
      stopService: mock(() => undefined),
      restartService: mock(() => undefined),
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
      'Clear the scrollback',
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
    for (const id of ['terminal.restart', 'terminal.find', 'terminal.clear', 'terminal.close']) {
      const command = find(commands, id);
      if (command.kind === 'run') command.run();
    }
    expect(context.actions.restart).toHaveBeenCalled();
    expect(context.actions.find).toHaveBeenCalled();
    expect(context.actions.clear).toHaveBeenCalled();
    expect(find(commands, 'terminal.clear').trailing).toBe('⌘L');
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

describe('a service’s commands', () => {
  const API = createService({ id: 'api' });
  const running = resolveServiceView(API, createTerminal({ id: 'svc', serviceId: 'api', startedAt: 0 }), NOW);
  const stopped = resolveServiceView(API, null, NOW);

  it('offers Restart and Stop while it runs, Start when it does not, and lists its tab with its state', () => {
    const context = createContext({
      terminals: [ONE, { ...TWO, id: 'svc', name: 'api', serviceId: 'api' }],
      services: [running],
      activeService: running,
    });
    const [page, others] = listTerminalPageCommands(context);
    const labels = page?.commands.map((command) => command.label) ?? [];
    expect(labels.slice(-2)).toEqual(['Restart api', 'Stop api']);
    expect(others?.commands[0]).toMatchObject({ label: 'api', hint: 'bun run dev', icon: 'IconPlay' });
    const commands = listServiceCommands([running, stopped], context.actions);
    for (const command of commands) if (command.kind === 'run') command.run();
    expect(commands.map((command) => command.label)).toEqual(['Restart api', 'Stop api', 'Start api']);
    expect(context.actions.restartService).toHaveBeenCalledWith(running);
    expect(context.actions.stopService).toHaveBeenCalledWith(running);
    expect(context.actions.startService).toHaveBeenCalledWith(stopped);
  });
});
