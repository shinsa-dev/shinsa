import { join } from 'node:path';
import { APP_IDENTITY } from '@shinsa/core';
import {
  BUNDLED_PROGRAM,
  COMMAND_DIR,
  type CommandLink,
  type LinkPlan,
  PATH_MARKER,
  PROFILE_MARKER,
  type ProfileEdit,
  type Shell,
} from './schema.ts';

export function resolveCommandDir(home: string) {
  return join(home, COMMAND_DIR);
}

export function resolveCommandLink(home: string) {
  return join(resolveCommandDir(home), APP_IDENTITY.command);
}

export function planCommandLink(link: CommandLink, program: string): LinkPlan {
  if (link.kind === 'missing') return 'create';
  if (link.kind === 'file') return 'leave';
  if (link.target === program) return 'keep';
  return BUNDLED_PROGRAM.test(link.target) ? 'replace' : 'leave';
}

export function resolveLoginPathArgs(shell: Shell) {
  const print =
    shell === 'fish'
      ? `printf '${PATH_MARKER}%s' (string join : $PATH)`
      : `printf '${PATH_MARKER}%s' "$PATH"`;
  return ['-ilc', print];
}

export function parseLoginPath(output: string) {
  const at = output.lastIndexOf(PATH_MARKER);
  if (at === -1) return null;
  return output.slice(at + PATH_MARKER.length).trim();
}

export function isOnPath(path: string, dir: string) {
  return path.split(':').some((entry) => entry.replace(/\/+$/, '') === dir);
}

export function resolveProfileEdit(shell: Shell, home: string): ProfileEdit {
  if (shell === 'fish') {
    return {
      file: join(home, '.config', 'fish', 'conf.d', 'shinsa.fish'),
      text: `${PROFILE_MARKER}\nfish_add_path -g $HOME/${COMMAND_DIR}\n`,
      mode: 'write',
    };
  }
  return {
    file: join(home, shell === 'zsh' ? '.zprofile' : '.bash_profile'),
    text: `\n${PROFILE_MARKER}\nexport PATH="$HOME/${COMMAND_DIR}:$PATH"\n`,
    mode: 'append',
  };
}

export function needsProfileEdit(current: string | null) {
  return !current?.includes(PROFILE_MARKER);
}
