import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test';
import {
  createServiceRestarter,
  EngineRestarter,
  EXIT_RESTART,
  isEngineBusy,
  type RestartDrain,
  resolveEngineActivity,
  stopWithin,
} from '../../src/instance/index.ts';
import { log } from '../../src/log/index.ts';
import { createRun, createStubEngine } from '../helpers/state.ts';

afterEach(() => {
  jest.useRealTimers();
});

function createDrain() {
  const held = new Set<string>();
  const calls: string[] = [];
  const onHeld: (() => void)[] = [];
  const drain: RestartDrain = {
    holdNewRuns: (listener) => {
      calls.push('hold');
      onHeld.push(listener);
    },
    releaseHeldRuns: () => calls.push('release'),
    isHeld: (runId) => held.has(runId),
  };
  return { drain, held, calls, onHeld };
}

function createRestarter(options: { service?: boolean; fail?: boolean; drain?: RestartDrain } = {}) {
  const stub = createStubEngine();
  let restarts = 0;
  const scheduled: (() => void)[] = [];
  const restarter = new EngineRestarter(stub.engine, {
    isService: () => Promise.resolve(options.service ?? true),
    restart: () => {
      restarts += 1;
      return options.fail ? Promise.reject(new Error('launchctl said no')) : Promise.resolve();
    },
    drain: options.drain,
    drainMs: 60_000,
    now: () => 1_000,
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
    expect(isEngineBusy(stub.state, (runId) => runId === 'live')).toBe(false);
  });
});

describe('resolveEngineActivity', () => {
  test('counts the working agents, leaving out held ones, and says when a restart comes at the latest', async () => {
    jest.useFakeTimers();
    const { drain, held } = createDrain();
    const { stub, restarter } = createRestarter({ drain });
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
      state.runs.next = createRun({ id: 'next' });
    });
    expect(resolveEngineActivity(stub.state)).toEqual({
      busy: true,
      working: 2,
      restart: null,
      restartBy: null,
    });
    held.add('next');
    await restarter.request('idle');
    expect(resolveEngineActivity(stub.state, restarter)).toEqual({
      busy: true,
      working: 1,
      restart: 'idle',
      restartBy: 61_000,
    });
  });
});

describe('draining before a restart', () => {
  test('holds new runs, ignores the held ones and restarts once the working ones hand over', async () => {
    jest.useFakeTimers();
    const { drain, held, calls } = createDrain();
    const { stub, restarter, flush, restarts } = createRestarter({ drain });
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
    });
    expect(await restarter.request('idle')).toEqual({ restarting: false });
    expect(await restarter.request('idle')).toEqual({ restarting: false });
    expect(calls).toEqual(['hold']);
    expect(restarter.deadlineAt).toBe(61_000);
    stub.update((state) => {
      state.runs.next = createRun({ id: 'next' });
    });
    held.add('next');
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live', endedAt: 9 });
    });
    stub.notify();
    await flush();
    expect(restarts()).toBe(1);
    expect(restarter.deadlineAt).toBeNull();
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(restarts()).toBe(1);
  });

  test('a run held after the last state change still lets the engine restart', async () => {
    jest.useFakeTimers();
    const { drain, held, onHeld } = createDrain();
    const { stub, restarter, flush, restarts } = createRestarter({ drain });
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
    });
    await restarter.request('idle');
    onHeld[0]?.();
    await flush();
    expect(restarts()).toBe(0);
    held.add('live');
    onHeld[0]?.();
    await flush();
    expect(restarts()).toBe(1);
  });

  test('restarts at the deadline with agents still working, since their runs resume after it', async () => {
    jest.useFakeTimers();
    const infos = spyOn(log, 'info').mockImplementation(() => undefined);
    const { stub, restarter, flush, restarts } = createRestarter();
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
    });
    await restarter.request('idle');
    jest.advanceTimersByTime(59_999);
    await flush();
    expect(restarts()).toBe(0);
    jest.advanceTimersByTime(1);
    await flush();
    expect(restarts()).toBe(1);
    expect(infos).toHaveBeenCalledWith(
      '[Engine] Agents still work past the restart deadline; their runs resume after it'
    );
    infos.mockRestore();
  });

  test('a restart that fails releases the held runs so work goes on', async () => {
    jest.useFakeTimers();
    const errors = spyOn(log, 'error').mockImplementation(() => undefined);
    const { drain, calls } = createDrain();
    const { stub, restarter, flush } = createRestarter({ drain, fail: true });
    stub.update((state) => {
      state.runs.live = createRun({ id: 'live' });
    });
    await restarter.request('idle');
    await restarter.request('now');
    await flush();
    await Promise.resolve();
    expect(calls).toEqual(['hold', 'release']);
    expect(restarter.pending).toBeNull();
    errors.mockRestore();
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
    jest.useFakeTimers();
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
    jest.advanceTimersByTime(249);
    expect(restarted).toBe(false);
    jest.advanceTimersByTime(1);
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
  test('restarts by stopping cleanly and exiting with the restart code, so launchd starts it again', async () => {
    jest.useFakeTimers();
    const stub = createStubEngine();
    const steps: string[] = [];
    const exited = Promise.withResolvers<void>();
    const restarter = createServiceRestarter(stub.engine, {
      byService: true,
      stop: () => {
        steps.push('stop');
        return Promise.resolve();
      },
      exit: (code) => {
        steps.push(`exit ${code}`);
        exited.resolve();
      },
    });
    await restarter.request('now');
    jest.advanceTimersByTime(250);
    await exited.promise;
    expect(steps).toEqual(['stop', `exit ${EXIT_RESTART}`]);
  });

  test('refuses when launchd did not start the engine, and exits the process by default', async () => {
    const stub = createStubEngine();
    const terminal = createServiceRestarter(stub.engine, { byService: false, stop: () => Promise.resolve() });
    await expect(terminal.request('now')).rejects.toMatchObject({ code: 'restart_unsupported' });
    const exited = Promise.withResolvers<void>();
    const exit = spyOn(process, 'exit').mockImplementation((() => exited.resolve()) as () => never);
    try {
      jest.useFakeTimers();
      const service = createServiceRestarter(stub.engine, { byService: true, stop: () => Promise.resolve() });
      await service.request('now');
      jest.advanceTimersByTime(250);
      await exited.promise;
      expect(exit).toHaveBeenCalledWith(EXIT_RESTART);
    } finally {
      exit.mockRestore();
    }
  });

  test('a stop that hangs or fails still exits with the restart code, so launchd brings the engine back', async () => {
    const stub = createStubEngine();
    const error = spyOn(log, 'error');
    try {
      for (const stop of [
        () => new Promise<void>(() => undefined),
        () => Promise.reject(new Error('stuck')),
      ]) {
        const exited = Promise.withResolvers<number>();
        const restarter = createServiceRestarter(stub.engine, {
          byService: true,
          stop,
          exit: (code) => exited.resolve(code),
          deadlineMs: 20,
        });
        await restarter.request('now');
        expect(await exited.promise).toBe(EXIT_RESTART);
      }
      expect(error).toHaveBeenCalledWith('[Engine] Did not stop in time, so it exits anyway', {
        deadlineMs: 20,
      });
      expect(error).toHaveBeenCalledWith('[Engine] Could not stop cleanly', { error: 'stuck' });
    } finally {
      error.mockRestore();
    }
  });
});

describe('stopWithin', () => {
  test('says whether the stop finished, failed or ran past its deadline', async () => {
    const error = spyOn(log, 'error');
    try {
      expect(await stopWithin(() => Promise.resolve(), 20)).toBe('stopped');
      expect(await stopWithin(() => Promise.reject(new Error('no')), 20)).toBe('failed');
      expect(await stopWithin(() => new Promise<void>(() => undefined), 20)).toBe('timed_out');
    } finally {
      error.mockRestore();
    }
  });
});
