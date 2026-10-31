import { DomainError, type TerminalInfo } from '@shinsa/core';
import type { Terminals } from '../terminals/index.ts';
import { resolveInstallCommand, resolvePrerequisiteLabel } from './prerequisites.ts';

export type InstallTerminals = Pick<Terminals, 'snapshot' | 'create' | 'rename' | 'run' | 'close'>;

export const SETUP_TERMINAL_PROJECT = 'setup';

export function openInstallTerminal(terminals: InstallTerminals, id: string, home: string): TerminalInfo {
  const command = resolveInstallCommand(id);
  const label = resolvePrerequisiteLabel(id);
  if (!(command && label))
    throw new DomainError('check_unknown', 'Shinsa has no command that fixes that check.');
  const name = `Set up ${label}`;
  for (const earlier of terminals.snapshot().terminals) {
    if (earlier.projectId === SETUP_TERMINAL_PROJECT && earlier.name === name) terminals.close(earlier.id);
  }
  const terminal = terminals.create({
    projectId: SETUP_TERMINAL_PROJECT,
    cwd: home,
    place: 'folder',
    taskId: null,
  });
  terminals.rename(terminal.id, name);
  terminals.run(terminal.id, `${command}; exit`);
  return { ...terminal, name };
}
