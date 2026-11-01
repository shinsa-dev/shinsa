import { describe, expect, it } from 'bun:test';
import { resolveDefaultShell } from '../../src/shell/login.ts';
import {
  listenOnce,
  PORT_PROBE_SOCKET,
  pickFreePort,
  resolveLoginShell,
  resolveShellCommand,
  resolveTerminalEnv,
  spawnTerminalProcess,
} from '../../src/terminals/pty.ts';
import { createTempDir, until } from '../helpers/index.ts';

function spawnShell(onText: (text: string) => void) {
  const decoder = new TextDecoder();
  return spawnTerminalProcess(['/bin/sh'], {
    cwd: createTempDir(),
    cols: 80,
    rows: 24,
    env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color', PS1: '$ ' },
    onData: (data) => onText(decoder.decode(data, { stream: true })),
  });
}

describe('spawnTerminalProcess', () => {
  it('runs a real shell in a pseudo-terminal: it echoes, resizes and reports its exit code', async () => {
    let output = '';
    const shell = spawnShell((text) => {
      output += text;
    });
    shell.write('echo "ready-$((40 + 2))"\r');
    await until('the shell answers', () => output.includes('ready-42'));
    shell.write('stty size\r');
    await until('the size is the one it started with', () => output.includes('24 80'));
    shell.resize(120, 40);
    shell.write('stty size\r');
    await until('the size follows a resize', () => output.includes('40 120'));
    shell.write(new TextEncoder().encode('exit 3\r'));
    expect(await shell.exited).toBe(3);
    shell.write('ignored\r');
    shell.resize(10, 10);
  });

  it('hangs up the shell when it is closed, as closing a terminal window does', async () => {
    let output = '';
    const shell = spawnShell((text) => {
      output += text;
    });
    shell.write('echo up\r');
    await until('the shell runs', () => output.includes('up'));
    shell.hangUp();
    expect(await shell.exited).not.toBe(0);
    shell.hangUp();
  });
});

describe('resolveLoginShell', () => {
  it('uses $SHELL, then the account’s shell, then the platform’s default', () => {
    expect(resolveLoginShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('/opt/homebrew/bin/fish');
    expect(resolveLoginShell({}, () => ({ shell: '/bin/bash' }))).toBe('/bin/bash');
    expect(resolveLoginShell({}, () => ({ shell: null }))).toBe(resolveDefaultShell());
    expect(
      resolveLoginShell({}, () => {
        throw new Error('no user');
      })
    ).toBe(resolveDefaultShell());
    expect(resolveLoginShell({})).toBeString();
  });

  it('starts it as a login shell', () => {
    expect(resolveShellCommand('/bin/zsh')).toEqual(['/bin/zsh', '-l']);
  });
});

describe('resolveTerminalEnv', () => {
  it('keeps your environment, names the terminal and drops what another terminal or the engine set', () => {
    const env = resolveTerminalEnv(
      {
        PATH: '/bin',
        HOME: '/home/ada',
        TERM: 'dumb',
        TERM_PROGRAM: 'ghostty',
        GHOSTTY_RESOURCES_DIR: '/x',
        SHINSA_SERVICE: '1',
        EMPTY: undefined,
      },
      '1.2.3'
    );
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/ada',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Shinsa',
      TERM_PROGRAM_VERSION: '1.2.3',
      LANG: 'en_US.UTF-8',
    });
    expect(resolveTerminalEnv({ LC_ALL: 'de_DE.UTF-8' }, '1').LANG).toBeUndefined();
  });
});

describe('pickFreePort', () => {
  it('keeps the port it is given while it is free and no other run holds it', () => {
    const listen = (port: number) => (port === 0 ? 6001 : port);
    expect(pickFreePort(4100, new Set(), listen)).toBe(4100);
    expect(pickFreePort(4100, new Set([4100]), listen)).toBe(6001);
    expect(pickFreePort(null, new Set(), listen)).toBe(6001);
  });

  it('asks again when the system hands back a port another run holds', () => {
    const ports = [6001, 6002];
    expect(pickFreePort(4100, new Set([6001]), (port) => (port === 0 ? (ports.shift() ?? null) : null))).toBe(
      6002
    );
  });

  it('gives up when no port is free', () => {
    expect(() => pickFreePort(null, new Set(), () => null)).toThrow('No free port for the service.');
  });

  it('binds a free port on this machine, and no port another program listens on', () => {
    const port = listenOnce(0);
    expect(port).toBeGreaterThan(0);
    const holder = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
    expect(listenOnce(holder.port)).toBeNull();
    holder.stop(true);
  });

  it('hangs up on anything that connects to the port while it checks it', () => {
    let ended = false;
    PORT_PROBE_SOCKET.data({ end: () => (ended = true) });
    expect(ended).toBe(true);
  });
});
