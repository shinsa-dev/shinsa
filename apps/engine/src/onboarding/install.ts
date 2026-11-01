import { DomainError, type TerminalInfo } from '@shinsa/core';
import type { Terminals } from '../terminals/index.ts';
import {
  listMissingInstalls,
  type Prerequisite,
  resolveInstallScript,
  resolvePrerequisiteLabel,
} from './prerequisites.ts';

export type InstallTerminals = Pick<Terminals, 'snapshot' | 'create' | 'rename' | 'run' | 'close'>;

export interface InstallScripts {
  resolve(id: string): string | null;
  resolveReply(command: string): string;
}

export const SETUP_TERMINAL_PROJECT = 'setup';

export const INSTALL_SCRIPTS: InstallScripts = {
  resolve: resolveInstallScript,
  resolveReply: (command) => command,
};

const REPLY_TERMINAL_NAME = 'Fix from the agent';

const ALL_TERMINAL_NAME = 'Set up the missing tools';

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

export function openInstallTerminal(
  terminals: InstallTerminals,
  id: string,
  home: string,
  scripts: InstallScripts = INSTALL_SCRIPTS
): TerminalInfo {
  const script = scripts.resolve(id);
  const label = resolvePrerequisiteLabel(id);
  if (!(script && label))
    throw new DomainError('check_unknown', 'Shinsa has no command that fixes that check.');
  return openSetupTerminal(terminals, `Set up ${label}`, `${script}; exit`, home);
}

export function openInstallAllTerminal(
  terminals: InstallTerminals,
  checks: readonly Prerequisite[],
  home: string,
  scripts: InstallScripts = INSTALL_SCRIPTS
): TerminalInfo {
  const steps = listMissingInstalls(checks).flatMap((id) => {
    const script = scripts.resolve(id);
    return script ? [`{ ${script}; }`] : [];
  });
  if (steps.length === 0) throw new DomainError('nothing_missing', 'Every tool Shinsa needs is installed.');
  return openSetupTerminal(terminals, ALL_TERMINAL_NAME, `${steps.join(' && ')}; exit`, home);
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
  home: string,
  scripts: InstallScripts = INSTALL_SCRIPTS
): TerminalInfo {
  if (!(body && isReplyCommand(body, command)))
    throw new DomainError(
      'command_unknown',
      'Shinsa runs only the commands the help task’s agent replied with.'
    );
  return openSetupTerminal(terminals, REPLY_TERMINAL_NAME, `${scripts.resolveReply(command)}\nexit`, home);
}
