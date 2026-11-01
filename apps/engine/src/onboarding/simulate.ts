import type { CommandResult } from '../shell/index.ts';
import type { InstallScripts } from './install.ts';
import { type CommandRunner, type PrerequisiteId, resolveInstallCommand } from './prerequisites.ts';

type SimulatedId = PrerequisiteId | 'gh_auth';

export interface SetupSimulation {
  run: CommandRunner;
  scripts: InstallScripts;
}

const CHECK_COMMANDS: Record<string, SimulatedId> = {
  'git --version': 'git',
  'brew --version': 'brew',
  'gh --version': 'gh',
  'gh auth status': 'gh_auth',
  'claude --version': 'claude',
  'bun --version': 'bun',
  'codex --version': 'codex',
};

const MISSING_OUTPUT: Partial<Record<SimulatedId, Pick<CommandResult, 'code' | 'stdout' | 'stderr'>>> = {
  git: {
    code: 1,
    stdout: '',
    stderr:
      'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun',
  },
  gh_auth: {
    code: 1,
    stdout: '',
    stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login',
  },
};

const NOT_FOUND: Pick<CommandResult, 'code' | 'stdout' | 'stderr'> = { code: 127, stdout: '', stderr: '' };

function quote(text: string) {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function printSimulated(command: string) {
  return `printf '%s\\n' 'Simulated setup: nothing is installed.' ${quote(`$ ${command}`)}; sleep 2`;
}

export function createSetupSimulation(ids: readonly string[], run: CommandRunner): SetupSimulation {
  const missing = new Set(ids);
  return {
    run: (command, cwd, options) => {
      const id = CHECK_COMMANDS[command.join(' ')];
      if (!(id && missing.has(id))) return run(command, cwd, options);
      return Promise.resolve({ ok: false, timedOut: false, ...(MISSING_OUTPUT[id] ?? NOT_FOUND) });
    },
    scripts: {
      resolve: (id) => {
        const command = resolveInstallCommand(id);
        if (!command) return null;
        if (id === 'gh' && missing.has('gh') && missing.has('brew')) {
          return `${printSimulated(command)}; echo 'zsh: command not found: brew'; false`;
        }
        missing.delete(id);
        if (id === 'brew') missing.delete('git');
        if (id === 'gh') missing.delete('gh_auth');
        return printSimulated(command);
      },
      resolveReply: printSimulated,
    },
  };
}
