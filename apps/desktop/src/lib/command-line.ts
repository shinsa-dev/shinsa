import { join } from 'node:path';

const COMMAND_DIR = '.local/bin';

export const PROFILE_MARKER = '# Added by Shinsa: puts the shinsa command on your PATH.';

const PATH_MARKER = '__SHINSA_PATH__';

const BUNDLED_PROGRAM = /\.app\/Contents\/Resources\/engine\/bin\/shinsa$/;

export type CommandLink = { kind: 'missing' } | { kind: 'link'; target: string } | { kind: 'file' };

export type LinkPlan = 'create' | 'replace' | 'keep' | 'leave';

export type Shell = 'zsh' | 'bash' | 'fish';

export interface ProfileEdit {
  file: string;
  text: string;
  mode: 'append' | 'write';
}

export function resolveCommandDir(home: string) {
  return join(home, COMMAND_DIR);
}

export function resolveCommandLink(home: string) {
  return join(resolveCommandDir(home), 'shinsa');
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
