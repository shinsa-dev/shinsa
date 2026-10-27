import { describe, expect, it } from 'bun:test';
import {
  isOnPath,
  needsProfileEdit,
  PROFILE_MARKER,
  parseLoginPath,
  planCommandLink,
  resolveCommandDir,
  resolveCommandLink,
  resolveLoginPathArgs,
  resolveProfileEdit,
} from '../../src/lib/command-line.ts';

const PROGRAM = '/Applications/Shinsa.app/Contents/Resources/engine/bin/shinsa';

describe('the shinsa command link', () => {
  it('lives in ~/.local/bin, where Claude Code, pipx and uv put theirs', () => {
    expect(resolveCommandDir('/Users/ada')).toBe('/Users/ada/.local/bin');
    expect(resolveCommandLink('/Users/ada')).toBe('/Users/ada/.local/bin/shinsa');
  });

  it('is made when missing and kept when it already points at this app', () => {
    expect(planCommandLink({ kind: 'missing' }, PROGRAM)).toBe('create');
    expect(planCommandLink({ kind: 'link', target: PROGRAM }, PROGRAM)).toBe('keep');
  });

  it('follows the app when it moved or another copy made the link', () => {
    const moved = '/Users/ada/Downloads/Shinsa.app/Contents/Resources/engine/bin/shinsa';
    expect(planCommandLink({ kind: 'link', target: moved }, PROGRAM)).toBe('replace');
  });

  it('never touches a shinsa that is not one the app made', () => {
    expect(planCommandLink({ kind: 'file' }, PROGRAM)).toBe('leave');
    expect(
      planCommandLink({ kind: 'link', target: '/Users/ada/shinsa/apps/engine/bin/shinsa' }, PROGRAM)
    ).toBe('leave');
  });
});

describe('the PATH your terminal sees', () => {
  it('asks an interactive login shell, so .zshrc and config.fish count too', () => {
    expect(resolveLoginPathArgs('zsh')).toEqual(['-ilc', `printf '__SHINSA_PATH__%s' "$PATH"`]);
    expect(resolveLoginPathArgs('bash')[0]).toBe('-ilc');
    expect(resolveLoginPathArgs('fish')).toEqual([
      '-ilc',
      `printf '__SHINSA_PATH__%s' (string join : $PATH)`,
    ]);
  });

  it('reads the PATH after anything the rc files print', () => {
    expect(parseLoginPath('Welcome back!\n__SHINSA_PATH__/usr/bin:/Users/ada/.local/bin\n')).toBe(
      '/usr/bin:/Users/ada/.local/bin'
    );
    expect(parseLoginPath('no marker here')).toBeNull();
  });

  it('finds the folder with or without a trailing slash', () => {
    expect(isOnPath('/usr/bin:/Users/ada/.local/bin/', '/Users/ada/.local/bin')).toBe(true);
    expect(isOnPath('/usr/bin:/Users/ada/.local/binaries', '/Users/ada/.local/bin')).toBe(false);
  });
});

describe('adding the folder to a shell that lacks it', () => {
  it('gives fish a file of its own in conf.d', () => {
    expect(resolveProfileEdit('fish', '/Users/ada')).toEqual({
      file: '/Users/ada/.config/fish/conf.d/shinsa.fish',
      text: `${PROFILE_MARKER}\nfish_add_path -g $HOME/.local/bin\n`,
      mode: 'write',
    });
  });

  it('appends one marked block to the zsh and bash login profiles', () => {
    expect(resolveProfileEdit('zsh', '/Users/ada')).toEqual({
      file: '/Users/ada/.zprofile',
      text: `\n${PROFILE_MARKER}\nexport PATH="$HOME/.local/bin:$PATH"\n`,
      mode: 'append',
    });
    expect(resolveProfileEdit('bash', '/Users/ada').file).toBe('/Users/ada/.bash_profile');
  });

  it('never adds the block twice', () => {
    expect(needsProfileEdit(null)).toBe(true);
    expect(needsProfileEdit('export EDITOR=vim\n')).toBe(true);
    expect(needsProfileEdit(`x\n${PROFILE_MARKER}\nexport PATH=…`)).toBe(false);
  });
});
