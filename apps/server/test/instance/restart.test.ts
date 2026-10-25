import { describe, expect, spyOn, test } from 'bun:test';
import { createServiceRestarter, EngineRestarter, isEngineBusy } from '../../src/instance/index.ts';
import { log } from '../../src/log/index.ts';
import { createRun, createStubEngine } from '../helpers/state.ts';

function createRestarter(options: { service?: boolean; fail?: boolean } = {}) {
  const stub = createStubEngine();
  let restarts = 0;
  const scheduled: (() => void)[] = [];
  const restarter = new EngineRestarter(stub.engine, {
    isService: () => Promise.resolve(options.service ?? true),
    restart: () => {
      restarts += 1;
      return options.fail ? Promise.reject(new Error('launchctl said no')) : Promise.resolve();
    },
    schedule: (run) => scheduled.push(run),
  });
  const flush = async () => {
    for (const run of scheduled.splice(0)) run();
    await Promise.resolve();
  };
  return { stub, restarter, flush, restarts: () => restarts };
}

describe('isEngineBusy', () => {
  test('is busy only while an agent is mid-turn, not while one is queued, waiting or done', () => {
    const { stub } = createRestarter();
    expect(isEngineBusy(stub.state)).toBe(false);
    stub.update((state) => {
      state.runs.queued = createRun({ id: 'queued', status: 'queued' });
      state.runs.waiting = createRun({ id: 'waiting', status: 'waiting' });
      state.runs.done = createRun({ id: 'done', endedAt: 5 });
    });
    expect(isEngineBusy(stub.state)).toBe(false);
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
    });
    expect(isEngineBusy(stub.state)).toBe(true);
  });
});

describe('EngineRestarter', () => {
  test('refuses when the engine does not run in the background', async () => {
    const { restarter } = createRestarter({ service: false });
    await expect(restarter.request('now')).rejects.toMatchObject({ code: 'restart_unsupported' });
  });

  test('restarts now even with agents mid-turn, once, since runs resume after it', async () => {
    const { stub, restarter, flush, restarts } = createRestarter();
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
    });
    expect(await restarter.request('now')).toEqual({ restarting: true });
    expect(await restarter.request('now')).toEqual({ restarting: true });
    await flush();
    expect(restarts()).toBe(1);
  });

  test('waits for agents to be idle, then restarts', async () => {
    const { stub, restarter, flush, restarts } = createRestarter();
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
    });
    expect(await restarter.request('idle')).toEqual({ restarting: false });
    expect(restarter.pending).toBe('idle');
    stub.notify();
    await flush();
    expect(restarts()).toBe(0);
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live', endedAt: 9 });
    });
    stub.notify();
    await flush();
    expect(restarts()).toBe(1);
  });

  test('restarts at once when asked to wait but nothing runs', async () => {
    const { restarter, flush, restarts } = createRestarter();
    expect(restarter.pending).toBeNull();
    expect(await restarter.request('idle')).toEqual({ restarting: true });
    await flush();
    expect(restarts()).toBe(1);
  });

  test('restarts a moment after answering, so the app hears that it will', async () => {
    const stub = createStubEngine();
    let restarted = false;
    const restarter = new EngineRestarter(stub.engine, {
      isService: () => Promise.resolve(true),
      restart: () => {
        restarted = true;
        return Promise.resolve();
      },
    });
    await restarter.request('now');
    expect(restarted).toBe(false);
    await Bun.sleep(300);
    expect(restarted).toBe(true);
  });

  test('logs a failed restart and can be asked again', async () => {
    const errors = spyOn(log, 'error').mockImplementation(() => undefined);
    const { restarter, flush, restarts } = createRestarter({ fail: true });
    await restarter.request('now');
    await flush();
    await Promise.resolve();
    expect(errors).toHaveBeenCalledWith('[Engine] Could not restart', { error: 'launchctl said no' });
    await restarter.request('now');
    await flush();
    expect(restarts()).toBe(2);
    errors.mockRestore();
  });
});

describe('createServiceRestarter', () => {
  function createService(server: { pid: number; service: boolean } | null) {
    let restarts = 0;
    return {
      status: () => Promise.resolve({ server } as never),
      restart: () => {
        restarts += 1;
        return Promise.resolve({} as never);
      },
      restarts: () => restarts,
    };
  }

  test('restarts through launchd only when this process is the background service on macOS', async () => {
    const stub = createStubEngine();
    const service = createService({ pid: 7, service: true });
    const restarter = createServiceRestarter(stub.engine, service, 'darwin', 7);
    await restarter.request('now');
    await Bun.sleep(300);
    expect(service.restarts()).toBe(1);
    const elsewhere = createServiceRestarter(stub.engine, createService(null), 'darwin', 7);
    await expect(elsewhere.request('now')).rejects.toMatchObject({ code: 'restart_unsupported' });
    const terminal = createServiceRestarter(
      stub.engine,
      createService({ pid: 7, service: false }),
      'darwin',
      7
    );
    await expect(terminal.request('now')).rejects.toMatchObject({ code: 'restart_unsupported' });
    const linux = createServiceRestarter(stub.engine, service, 'linux', 7);
    await expect(linux.request('now')).rejects.toMatchObject({ code: 'restart_unsupported' });
  });
});
