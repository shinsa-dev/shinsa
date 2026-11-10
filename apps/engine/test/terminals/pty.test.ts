import { describe, expect, it } from 'bun:test';
import { Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { ShellLayer } from '../../src/shell/layers.ts';
import { resolveDefaultShell } from '../../src/shell/login.ts';
import {
  listenOnce,
  PORT_PROBE_SOCKET,
  resolveLoginShell,
  resolveShellCommand,
  resolveTerminalEnv,
} from '../../src/terminals/pty.ts';
import { TerminalPty } from '../../src/terminals/pty/service.ts';
import type { PortListener, TerminalSpawnOptions } from '../../src/terminals/schema.ts';

const PTY = TerminalPty.layer.pipe(Layer.provide(ShellLayer));

function spawnTerminalProcess(command: string[], options: TerminalSpawnOptions) {
  return Effect.runSync(TerminalPty.use((pty) => pty.spawn(command, options)).pipe(Effect.provide(PTY)));
}

function pickFreePort(preferred: number | null, taken: ReadonlySet<number>, listen: PortListener) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(TerminalPty.use((pty) => pty.pickPort(preferred, taken, listen)));
      yield* TestClock.adjust('10 seconds');
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(Layer.merge(PTY, TestClock.layer())))
  );
}
import { createTempDir } from '../helpers/temp.ts';
import { until } from '../helpers/until.ts';

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

describe('TerminalPty.spawn', () => {
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

function spawnCommand(script: string, onText: (text: string) => void) {
  const decoder = new TextDecoder();
  return spawnTerminalProcess(['/bin/sh', '-c', script], {
    cwd: createTempDir(),
    cols: 80,
    rows: 24,
    env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' },
    onData: (data) => onText(decoder.decode(data, { stream: true })),
  });
}

function isAlive(pid: number) {
  const state = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)])
    .stdout.toString()
    .trim();
  return state !== '' && !state.startsWith('Z');
}

async function readChildPid(read: () => string) {
  await until('the command prints its child', () => /child-(\d+)\r?\n/.test(read()));
  return Number(/child-(\d+)\r?\n/.exec(read())?.[1]);
}

describe('TerminalPty process group', () => {
  it('stops a grandchild that ignores the hang-up before it counts the stop as done', async () => {
    let output = '';
    const service = spawnCommand(`sh -c 'trap "" HUP; echo "child-$$"; exec sleep 60' & wait`, (text) => {
      output += text;
    });
    const grandchild = await readChildPid(() => output);
    expect(isAlive(grandchild)).toBe(true);
    service.hangUp();
    await service.exited;
    expect(isAlive(grandchild)).toBe(false);
  }, 10_000);

  it('stops what a command left running, even when it ignores the hang-up, once the command exits on its own', async () => {
    let output = '';
    const service = spawnCommand(
      `sh -c 'trap "" HUP; echo "child-$$"; exec sleep 60' & read line`,
      (text) => {
        output += text;
      }
    );
    const left = await readChildPid(() => output);
    service.write('\r');
    expect(await service.exited).toBe(0);
    expect(isAlive(left)).toBe(false);
  }, 10_000);
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

describe('TerminalPty.pickPort', () => {
  it('keeps the port it is given while it is free and no other run holds it', async () => {
    const listen = (port: number) => (port === 0 ? 6001 : port);
    expect(await pickFreePort(4100, new Set(), listen)).toBe(4100);
    expect(await pickFreePort(4100, new Set([4100]), listen)).toBe(6001);
    expect(await pickFreePort(null, new Set(), listen)).toBe(6001);
  });

  it('waits for the port it is given while the last run lets go of it', async () => {
    const tries: number[] = [];
    const listen = (port: number) => {
      tries.push(port);
      if (port === 0) return 6001;
      return tries.length > 3 ? port : null;
    };
    expect(await pickFreePort(4100, new Set(), listen)).toBe(4100);
    expect(tries).toEqual([4100, 4100, 4100, 4100]);
  });

  it('takes another port when the one it is given stays taken past the wait', async () => {
    const tries: number[] = [];
    const listen = (port: number) => {
      tries.push(port);
      return port === 0 ? 6001 : null;
    };
    expect(await pickFreePort(4100, new Set(), listen)).toBe(6001);
    expect(tries.filter((port) => port === 4100).length).toBeGreaterThan(40);
    expect(tries.at(-1)).toBe(0);
  });

  it('asks again when the system hands back a port another run holds', async () => {
    const ports = [6001, 6002];
    expect(
      await pickFreePort(4100, new Set([6001]), (port) => (port === 0 ? (ports.shift() ?? null) : null))
    ).toBe(6002);
  });

  it('gives up when no port is free', async () => {
    await expect(pickFreePort(null, new Set(), () => null)).rejects.toThrow('No free port for the service.');
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
