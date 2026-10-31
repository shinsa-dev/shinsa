import { DomainError, type TerminalInfo } from '@shinsa/core';
import type { Terminals } from '../terminals/index.ts';
import { resolveInstallCommand, resolvePrerequisiteLabel } from './prerequisites.ts';

export type InstallTerminals = Pick<Terminals, 'snapshot' | 'create' | 'rename' | 'run' | 'close'>;

export const SETUP_TERMINAL_PROJECT = 'setup';

const REPLY_TERMINAL_NAME = 'Fix from the agent';

const FENCE = /```([^\n]*)\n([\s\S]*?)```/g;

const PROMPT = /^\s*[$%>]\s?/;

function openSetupTerminal(terminals: InstallTerminals, name: string, script: string, home: string) {
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
  terminals.run(terminal.id, script);
  return { ...terminal, name };
}

export function openInstallTerminal(terminals: InstallTerminals, id: string, home: string): TerminalInfo {
  const command = resolveInstallCommand(id);
  const label = resolvePrerequisiteLabel(id);
  if (!(command && label))
    throw new DomainError('check_unknown', 'Shinsa has no command that fixes that check.');
  return openSetupTerminal(terminals, `Set up ${label}`, `${command}; exit`, home);
}

export function isReplyCommand(body: string, command: string) {
  const wanted = command
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (wanted.length === 0) return false;
  for (const [, info = '', code = ''] of body.matchAll(FENCE)) {
    if (!/\brun\b/.test(info)) continue;
    const lines = new Set(code.split('\n').map((line) => line.replace(PROMPT, '').trim()));
    if (wanted.every((line) => lines.has(line))) return true;
  }
  return false;
}

export function openReplyTerminal(
  terminals: InstallTerminals,
  body: string | null,
  command: string,
  home: string
): TerminalInfo {
  if (!(body && isReplyCommand(body, command)))
    throw new DomainError(
      'command_unknown',
      'Shinsa runs only the commands the help task’s agent replied with.'
    );
  return openSetupTerminal(terminals, REPLY_TERMINAL_NAME, `${command}\nexit`, home);
}
