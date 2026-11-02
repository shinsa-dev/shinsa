import { describe, expect, it } from 'bun:test';
import { Option } from 'effect';
import { PATH_MARKER, PROFILE_MARKER } from '../../src/command-line/schema.ts';
import { CommandLine } from '../../src/command-line/service.ts';
import { createWorld, type DesktopWorld, RESOURCES, runDesktop } from '../support/desktop.ts';

const PROGRAM = `${RESOURCES}/engine/bin/shinsa`;

const LINK = '/Users/me/.local/bin/shinsa';

const ZPROFILE = '/Users/me/.zprofile';

const BASH_PROFILE = '/Users/me/.bash_profile';

const FISH_CONFIG = '/Users/me/.config/fish/conf.d/shinsa.fish';

const answerPath = (path: string) => () => `Last login: today\n${PATH_MARKER}${path}`;

function sync(world: DesktopWorld) {
  return runDesktop(
    world,
    CommandLine.use((commandLine) => commandLine.sync)
  ).then(Option.getOrNull);
}

function createInstalled(overrides: Partial<DesktopWorld> = {}) {
  const world = createWorld({ shellPath: answerPath('/usr/bin:/bin'), ...overrides });
  world.files.set(PROGRAM, '');
  world.files.set('/bin/zsh', '');
  return world;
}

describe('the shinsa command on your PATH', () => {
  it('does nothing when the app carries no engine', async () => {
    const world = createWorld();
    expect(await sync(world)).toBeNull();
    expect(world.links.size).toBe(0);
  });

  it('links the command and adds ~/.local/bin to zsh’s login PATH', async () => {
    const world = createInstalled();
    expect(await sync(world)).toEqual({ link: 'create', addedTo: ['zsh'] });
    expect(world.links.get(LINK)).toBe(PROGRAM);
    expect(world.files.get(ZPROFILE)).toContain(PROFILE_MARKER);
    expect(world.shells).toEqual([`/bin/zsh -ilc printf '${PATH_MARKER}%s' "$PATH"`]);
  });

  it('moves a link another copy of the app made and keeps one that points here', async () => {
    const moved = createInstalled();
    moved.links.set(LINK, '/Users/me/Downloads/Shinsa.app/Contents/Resources/engine/bin/shinsa');
    expect((await sync(moved))?.link).toBe('replace');
    expect(moved.links.get(LINK)).toBe(PROGRAM);
    const kept = createInstalled();
    kept.links.set(LINK, PROGRAM);
    expect((await sync(kept))?.link).toBe('keep');
  });

  it('never touches a shinsa it did not make', async () => {
    const world = createInstalled();
    world.links.set(LINK, '/Users/me/shinsa/apps/engine/bin/shinsa');
    expect((await sync(world))?.link).toBe('leave');
    expect(world.links.get(LINK)).toBe('/Users/me/shinsa/apps/engine/bin/shinsa');
  });

  it('leaves a profile alone when the folder is on PATH or the line is already there', async () => {
    const onPath = createInstalled({ shellPath: answerPath('/Users/me/.local/bin/:/usr/bin') });
    expect((await sync(onPath))?.addedTo).toEqual([]);
    const marked = createInstalled();
    marked.files.set(ZPROFILE, `${PROFILE_MARKER}\n`);
    expect((await sync(marked))?.addedTo).toEqual([]);
    expect(marked.files.get(ZPROFILE)).toBe(`${PROFILE_MARKER}\n`);
  });

  it('skips a shell whose login PATH cannot be read', async () => {
    const world = createInstalled({ shellPath: () => null });
    expect((await sync(world))?.addedTo).toEqual([]);
    const garbled = createInstalled({ shellPath: () => 'no marker here' });
    expect((await sync(garbled))?.addedTo).toEqual([]);
  });

  it('asks bash only when you use it, and writes fish’s own file', async () => {
    const unused = createInstalled();
    unused.files.set('/bin/bash', '');
    expect((await sync(unused))?.addedTo).toEqual(['zsh']);
    const profiled = createInstalled();
    profiled.files.set('/bin/bash', '');
    profiled.files.set(BASH_PROFILE, '');
    expect((await sync(profiled))?.addedTo).toEqual(['zsh', 'bash']);
    const login = createInstalled({ env: { SHELL: '/bin/bash' } });
    login.files.set('/bin/bash', '');
    login.files.set('/opt/homebrew/bin/fish', '');
    expect((await sync(login))?.addedTo).toEqual(['zsh', 'bash', 'fish']);
    expect(login.files.get(FISH_CONFIG)).toContain('fish_add_path -g $HOME/.local/bin');
  });

  it('gives up quietly when a file cannot be written', async () => {
    const world = createInstalled({ unwritable: new Set([LINK]) });
    expect(await sync(world)).toBeNull();
    const profile = createInstalled({ unwritable: new Set([ZPROFILE]) });
    expect(await sync(profile)).toBeNull();
  });
});
