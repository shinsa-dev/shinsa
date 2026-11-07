import { Duration, Schema } from 'effect';
import type { FileEntry } from '../files/schema.ts';

export const COMMAND_DIR = '.local/bin';

export const PROFILE_MARKER = '# Added by Shinsa: puts the shinsa command on your PATH.';

export const PATH_MARKER = '__SHINSA_PATH__';

export const BUNDLED_PROGRAM = /\.app\/Contents\/Resources\/engine\/bin\/shinsa$/;

export const LOGIN_SHELL_TIMEOUT = Duration.seconds(5);
export const LOGIN_SHELL_ENV = { TERM: 'dumb' };

export const Shell = Schema.Literals(['zsh', 'bash', 'fish']);

export type Shell = typeof Shell.Type;

export const SHELLS: readonly { shell: Shell; programs: readonly string[] }[] = [
  { shell: 'zsh', programs: ['/bin/zsh'] },
  { shell: 'bash', programs: ['/bin/bash'] },
  { shell: 'fish', programs: ['/opt/homebrew/bin/fish', '/usr/local/bin/fish'] },
];

export type CommandLink = FileEntry;

export type LinkPlan = 'create' | 'replace' | 'keep' | 'leave';

export interface ProfileEdit {
  file: string;
  text: string;
  mode: 'append' | 'write';
}

export interface CommandLineSync {
  readonly link: LinkPlan;
  readonly addedTo: readonly Shell[];
}
