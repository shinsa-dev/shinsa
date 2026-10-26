import { describe, expect, it } from 'bun:test';
import { FLOW_LIMITS, TerminalSession } from '../../src/terminals/session.ts';
import { until } from '../helpers/index.ts';
import { createFakeSpawner, createFakeViewer, createInfo } from './fakes.ts';

function createSession(saved: string | null = null) {
  const changes: string[] = [];
  const screens: number[] = [];
  const session = new TerminalSession({
    info: createInfo(),
    saved,
    now: () => 50,
    onChange: (each) => changes.push(each.info.status),
    onScreen: () => screens.push(1),
  });
  const fake = createFakeSpawner();
  session.start({
    command: ['/bin/fish', '-l'],
    env: { TERM: 'xterm-256color' },
    spawn: fake.spawn,
    now: 10,
  });
  const process = fake.spawned[0];
  if (!process) throw new Error('No process');
  return { session, process, fake, changes, screens };
}

describe('TerminalSession', () => {
  it('starts the shell in its folder at the mirror’s size, once', () => {
    const { session, process, fake } = createSession();
    expect(process.command).toEqual(['/bin/fish', '-l']);
    expect(process.options).toMatchObject({
      cwd: '/tmp',
      cols: 100,
      rows: 30,
      env: { TERM: 'xterm-256color' },
    });
    session.start({ command: ['again'], env: {}, spawn: fake.spawn, now: 11 });
    expect(fake.spawned).toHaveLength(1);
    expect(session.running).toBe(true);
    session.dispose();
  });

  it('gives a new viewer the screen so far, then the output as it comes, a batch at a time', async () => {
    const { session, process } = createSession();
    process.emit('before\r\n');
    const viewer = createFakeViewer();
    session.attach(viewer);
    expect(viewer.controls()).toEqual([{ type: 'reset', cols: 100, rows: 30 }, { type: 'live' }]);
    expect(viewer.text()).toContain('before');
    expect(session.viewers).toBe(1);
    const sent = viewer.frames.length;
    process.emit('one ');
    process.emit('two');
    await until('the batch goes out', () => viewer.frames.length === sent + 1);
    expect(viewer.text().endsWith('one two')).toBe(true);
    session.detach(viewer);
    process.emit('after');
    expect(viewer.frames).toHaveLength(sent + 1);
    session.dispose();
  });

  it('sends a large batch at once', () => {
    const { session, process } = createSession();
    const viewer = createFakeViewer();
    session.attach(viewer);
    const sent = viewer.frames.length;
    process.emit('x'.repeat(FLOW_LIMITS.batchBytes));
    expect(viewer.frames).toHaveLength(sent + 1);
    session.dispose();
  });

  it('stops sending to a viewer that falls behind, and gives it the whole screen again once it drains', () => {
    const { session, process } = createSession();
    const viewer = createFakeViewer();
    session.attach(viewer);
    viewer.bufferedBytes = FLOW_LIMITS.highWater + 1;
    process.emit('x'.repeat(FLOW_LIMITS.batchBytes));
    const sent = viewer.frames.length;
    process.emit('y'.repeat(FLOW_LIMITS.batchBytes));
    expect(viewer.frames).toHaveLength(sent);
    session.drain(viewer);
    expect(viewer.frames).toHaveLength(sent);
    viewer.bufferedBytes = 0;
    session.drain(viewer);
    expect(viewer.controls()).toHaveLength(4);
    session.drain(viewer);
    expect(viewer.controls()).toHaveLength(4);
    session.drain(createFakeViewer());
    session.dispose();
  });

  it('treats a dropped frame as falling behind', () => {
    const { session, process } = createSession();
    const viewer = createFakeViewer();
    session.attach(viewer);
    viewer.answer = 0;
    process.emit('x'.repeat(FLOW_LIMITS.batchBytes));
    const sent = viewer.frames.length;
    process.emit('y'.repeat(FLOW_LIMITS.batchBytes));
    expect(viewer.frames).toHaveLength(sent);
    session.dispose();
  });

  it('passes your keys and size to the shell, and skips a resize to the size it has', () => {
    const { session, process } = createSession();
    session.input('ls\r');
    session.resize(120, 40);
    session.resize(120, 40);
    expect(process.written).toContain('ls\r');
    expect(process.sizes).toEqual([[120, 40]]);
    session.dispose();
  });

  it('answers the terminal’s questions itself, with the page’s colours', async () => {
    const { session, process } = createSession();
    process.emit('\u001b]11;?\u001b\\');
    await until('the default colour is answered', () => process.written.length === 1);
    session.replaceColors({ foreground: '#111111', background: '#fafafa', cursor: '#0055ff' });
    process.emit('\u001b]11;?\u001b\\\u001b]10;?\u001b\\\u001b]11;rgb:0/0/0\u001b\\\u001b[c');
    await until('the replies arrive', () => process.written.length >= 4);
    expect(process.written[0]).toBe('\u001b]11;rgb:ffff/ffff/ffff\u001b\\');
    expect(process.written[1]).toBe('\u001b]11;rgb:fafa/fafa/fafa\u001b\\');
    expect(process.written[2]).toBe('\u001b]10;rgb:1111/1111/1111\u001b\\');
    expect(process.written[3]).toStartWith('\u001b[?');
    session.dispose();
  });

  it('follows the shell’s title, ignoring a repeat', async () => {
    const { session, process, changes } = createSession();
    process.emit('\u001b]0;bun dev\u0007');
    await until('the title changes', () => session.info.title === 'bun dev');
    process.emit('\u001b]0;bun dev\u0007');
    await session.serializeScreen();
    expect(changes).toEqual(['running']);
    process.emit('\u001b]0;\u0007');
    await until('an empty title clears it', () => session.info.title === null);
    session.dispose();
  });

  it('records how the shell exited and starts again below its last output', async () => {
    const { session, process, fake, changes } = createSession();
    process.emit('done\r\n');
    const viewer = createFakeViewer();
    session.attach(viewer);
    process.exit(2);
    await until('the exit is recorded', () => session.info.status === 'exited');
    expect(session.info).toMatchObject({ exitCode: 2, endedAt: 50 });
    expect(changes).toEqual(['exited']);
    session.input('ignored');
    session.start({ command: ['/bin/fish', '-l'], env: {}, spawn: fake.spawn, now: 60 });
    expect(session.info).toMatchObject({ status: 'running', exitCode: null, startedAt: 60, endedAt: null });
    expect(await session.serializeScreen()).toContain('done');
    session.dispose();
  });

  it('marks the shell stopped, not exited, when Shinsa stops', async () => {
    const { session, process } = createSession();
    await session.stop();
    expect(process.hungUp).toBe(true);
    expect(session.info).toMatchObject({ status: 'stopped', exitCode: null });
    expect(session.stop()).toBeUndefined();
    session.hangUp();
    session.dispose();
  });

  it('shows the screen it saved, and ends its viewers and ignores late output once disposed', async () => {
    const { session, process, screens } = createSession('saved line');
    expect(await session.serializeScreen()).toContain('saved line');
    const viewer = createFakeViewer();
    session.attach(viewer);
    session.hangUp();
    session.dispose();
    expect(viewer.ended).toBe(true);
    const before = screens.length;
    process.emit('late');
    expect(screens).toHaveLength(before);
  });
});
