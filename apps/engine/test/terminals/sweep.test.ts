import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { AUTO_CLOSE_LIMITS, resolveAutoClose } from '../../src/terminals/sweep.ts';
import { until } from '../helpers/until.ts';
import { createFakeViewer, createInfo } from './fakes.ts';
import { createTerminals, runAsync } from './harness.ts';

const START = { projectId: 'p1', cwd: '/code/web', place: 'repository', taskId: null } as const;

const SERVICE = {
  name: 'api',
  cwd: '/code/web/apps/api',
  command: 'bun run dev',
  env: { PORT: '4000' },
  previewUrl: null,
  portVariable: 'PORT',
};

const { exitedMs, idleMs } = AUTO_CLOSE_LIMITS;

describe('resolveAutoClose', () => {
  const exited = createInfo({ status: 'exited', exitCode: 0, endedAt: 1000 });

  it('closes a shell that exited once it has sat unseen for the exited limit', () => {
    const candidate = { info: exited, running: false, viewers: 0, lastActiveAt: 500 };
    expect(resolveAutoClose(candidate, 1000 + exitedMs - 1)).toBe('keep');
    expect(resolveAutoClose(candidate, 1000 + exitedMs)).toBe('close');
  });

  it('counts from the last time someone looked at an exited shell', () => {
    const candidate = { info: exited, running: false, viewers: 0, lastActiveAt: 5000 };
    expect(resolveAutoClose(candidate, 1000 + exitedMs)).toBe('keep');
    expect(resolveAutoClose(candidate, 5000 + exitedMs)).toBe('close');
  });

  it('keeps a terminal someone has open, and never closes a service', () => {
    expect(resolveAutoClose({ info: exited, running: false, viewers: 1, lastActiveAt: 0 }, 1e12)).toBe(
      'keep'
    );
    const service = createInfo({ serviceId: 's1', status: 'exited', endedAt: 0 });
    expect(resolveAutoClose({ info: service, running: false, viewers: 0, lastActiveAt: 0 }, 1e12)).toBe(
      'keep'
    );
  });

  it('closes a running shell only after the idle limit, and only once nothing runs in it', () => {
    const running = createInfo({ startedAt: 0 });
    const candidate = { info: running, running: true, viewers: 0, lastActiveAt: 0 };
    expect(resolveAutoClose(candidate, idleMs - 1)).toBe('keep');
    expect(resolveAutoClose(candidate, idleMs)).toBe('close_when_quiet');
  });

  it('gives a shell the engine stopped on a restart the idle limit, not the exited one', () => {
    const stopped = createInfo({ status: 'stopped', endedAt: 0 });
    const candidate = { info: stopped, running: false, viewers: 0, lastActiveAt: 0 };
    expect(resolveAutoClose(candidate, exitedMs)).toBe('keep');
    expect(resolveAutoClose(candidate, idleMs)).toBe('close');
  });
});

describe('Terminals sweep', () => {
  it('closes unused shells and keeps services, open terminals and busy shells', async () => {
    let now = 0;
    let foreground: string | null = 'vim';
    const { terminals, fake, close } = await createTerminals({
      now: () => now,
      pty: { readForeground: () => Effect.sync(() => foreground) },
    });
    const ended = await runAsync(terminals.create(START));
    const idle = await runAsync(terminals.create(START));
    const watched = await runAsync(terminals.create(START));
    const service = await runAsync(terminals.addService('p1', SERVICE));
    const served = await runAsync(
      terminals.startService(service.id, { cwd: SERVICE.cwd, place: 'repository', taskId: null })
    );
    const viewer = createFakeViewer();
    await runAsync(terminals.attach(watched.id, viewer));
    fake.spawned[0]?.exit(0);
    await until(
      'the shell exits',
      async () => (await runAsync(terminals.find(ended.id))).info.status === 'exited'
    );

    now = exitedMs;
    await runAsync(terminals.sweep);
    expect(await runAsync(terminals.select(ended.id))).toBeNull();
    expect(await runAsync(terminals.select(idle.id))).not.toBeNull();

    now = idleMs;
    await runAsync(terminals.sweep);
    expect(await runAsync(terminals.select(idle.id))).not.toBeNull();

    foreground = null;
    await runAsync(terminals.sweep);
    expect(await runAsync(terminals.select(idle.id))).toBeNull();
    expect(fake.spawned[1]?.hungUp).toBe(true);
    expect(await runAsync(terminals.select(watched.id))).not.toBeNull();
    expect(await runAsync(terminals.select(served.id))).not.toBeNull();

    (await runAsync(terminals.find(watched.id))).detach(viewer);
    now = 2 * idleMs - 1;
    await runAsync(terminals.sweep);
    expect(await runAsync(terminals.select(watched.id))).not.toBeNull();
    fake.spawned[2]?.emit('output');
    now = 3 * idleMs - 2;
    await runAsync(terminals.sweep);
    expect(await runAsync(terminals.select(watched.id))).not.toBeNull();
    now = 3 * idleMs - 1;
    await runAsync(terminals.sweep);
    expect(await runAsync(terminals.select(watched.id))).toBeNull();
    expect((await runAsync(terminals.snapshot)).terminals.map((each) => each.id)).toEqual([served.id]);
    await close();
  });

  it('gives every terminal a fresh window when the engine starts again, however long it was down', async () => {
    let now = 0;
    const first = await createTerminals({ now: () => now });
    const shell = await runAsync(first.terminals.create(START));
    await runAsync(first.terminals.stop);
    await first.close();

    now = 10 * idleMs;
    const again = await createTerminals({ now: () => now, dataDir: first.dataDir });
    await runAsync(again.terminals.sweep);
    expect((await runAsync(again.terminals.find(shell.id))).info.status).toBe('stopped');
    now += idleMs - 1;
    await runAsync(again.terminals.sweep);
    expect(await runAsync(again.terminals.select(shell.id))).not.toBeNull();
    now += 1;
    await runAsync(again.terminals.sweep);
    expect(await runAsync(again.terminals.select(shell.id))).toBeNull();
    await again.close();
  });

  it('closes nothing in inspect mode or once stopped', async () => {
    let now = 0;
    const read = await createTerminals({ now: () => now, readOnly: true });
    now = 10 * idleMs;
    await runAsync(read.terminals.sweep);
    await read.close();

    const { terminals, fake, close } = await createTerminals({ now: () => now });
    now = 0;
    const shell = await runAsync(terminals.create(START));
    fake.spawned[0]?.exit(0);
    await until(
      'the shell exits',
      async () => (await runAsync(terminals.find(shell.id))).info.status === 'exited'
    );
    await runAsync(terminals.stop);
    now = 10 * idleMs;
    await runAsync(terminals.sweep);
    expect(await runAsync(terminals.select(shell.id))).not.toBeNull();
    await close();
  });
});
