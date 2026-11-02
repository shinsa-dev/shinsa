import { Schema } from 'effect';

export const COMMAND_DIR = '.local/bin';

export const PROFILE_MARKER = '# Added by Shinsa: puts the shinsa command on your PATH.';

export const PATH_MARKER = '__SHINSA_PATH__';

export const BUNDLED_PROGRAM = /\.app\/Contents\/Resources\/engine\/bin\/shinsa$/;

export const LOGIN_SHELL_TIMEOUT_MS = 5000;

export const Shell = Schema.Literals(['zsh', 'bash', 'fish']);

export type Shell = typeof Shell.Type;

export const SHELLS: readonly { shell: Shell; programs: readonly string[] }[] = [
  { shell: 'zsh', programs: ['/bin/zsh'] },
  { shell: 'bash', programs: ['/bin/bash'] },
  { shell: 'fish', programs: ['/opt/homebrew/bin/fish', '/usr/local/bin/fish'] },
];

export type CommandLink = { kind: 'missing' } | { kind: 'link'; target: string } | { kind: 'file' };

export type LinkPlan = 'create' | 'replace' | 'keep' | 'leave';

export interface ProfileEdit {
  file: string;
  text: string;
  mode: 'append' | 'write';
}
