import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import type { Terminals } from '../terminals/index.ts';
import {
  listMissingInstalls,
  type Prerequisite,
  resolveInstallScript,
  resolvePrerequisiteLabel,
} from './prerequisites.ts';

export type InstallTerminals = Pick<Terminals['Service'], 'snapshot' | 'create' | 'rename' | 'run' | 'close'>;

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

const openSetupTerminal = Effect.fn('InstallTerminals.open')(function* (
  terminals: InstallTerminals,
  name: string,
  script: string,
  home: string
) {
  for (const earlier of (yield* terminals.snapshot).terminals) {
    if (earlier.projectId === SETUP_TERMINAL_PROJECT && earlier.name === name)
      yield* terminals.close(earlier.id);
  }
  const terminal = yield* terminals.create({
    projectId: SETUP_TERMINAL_PROJECT,
    cwd: home,
    place: 'folder',
    taskId: null,
  });
  yield* terminals.rename(terminal.id, name);
  yield* terminals.run(terminal.id, script);
  return { ...terminal, name };
});

export const openInstallTerminal = Effect.fn('InstallTerminals.openInstall')(function* (
  terminals: InstallTerminals,
  id: string,
  home: string,
  scripts: InstallScripts = INSTALL_SCRIPTS
) {
  const script = scripts.resolve(id);
  const label = resolvePrerequisiteLabel(id);
  if (!(script && label))
    return yield* new DomainError({
      code: 'check_unknown',
      message: 'Shinsa has no command that fixes that check.',
    });
  return yield* openSetupTerminal(terminals, `Set up ${label}`, `${script}; exit`, home);
});

export const openInstallAllTerminal = Effect.fn('InstallTerminals.openInstallAll')(function* (
  terminals: InstallTerminals,
  checks: readonly Prerequisite[],
  home: string,
  scripts: InstallScripts = INSTALL_SCRIPTS
) {
  const steps = listMissingInstalls(checks).flatMap((id) => {
    const script = scripts.resolve(id);
    return script ? [`{ ${script}; }`] : [];
  });
  if (steps.length === 0)
    return yield* new DomainError({
      code: 'nothing_missing',
      message: 'Every tool Shinsa needs is installed.',
    });
  return yield* openSetupTerminal(terminals, ALL_TERMINAL_NAME, `${steps.join(' && ')}; exit`, home);
});

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

export const openReplyTerminal = Effect.fn('InstallTerminals.openReply')(function* (
  terminals: InstallTerminals,
  body: string | null,
  command: string,
  home: string,
  scripts: InstallScripts = INSTALL_SCRIPTS
) {
  if (!(body && isReplyCommand(body, command)))
    return yield* new DomainError({
      code: 'command_unknown',
      message: 'Shinsa runs only the commands the help task’s agent replied with.',
    });
  return yield* openSetupTerminal(
    terminals,
    REPLY_TERMINAL_NAME,
    `${scripts.resolveReply(command)}\nexit`,
    home
  );
});
