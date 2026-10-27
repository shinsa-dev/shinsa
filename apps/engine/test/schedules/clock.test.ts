import { afterEach, describe, expect, setSystemTime, spyOn, test } from 'bun:test';
import { createState, DomainError, type Schedule, type ShinsaCommand } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import type { Engine } from '../../src/runtime/engine.ts';
import { ScheduleClock } from '../../src/schedules/clock.ts';
import { until } from '../helpers/index.ts';
import { addSchedule, createWorld } from './fixtures.ts';

const MINUTE = 60_000;

const START = Date.parse('2026-10-23T12:00:00Z');

afterEach(() => {
  setSystemTime();
});

describe('the schedule clock', () => {
  test('fires a due schedule once under its slot’s id, and a missed run once on wake', async () => {
    setSystemTime(START);
    const world = await createWorld();
    const schedule = await addSchedule(world, { kind: 'interval', everyMinutes: 10 });
    const clock = new ScheduleClock(world.engine);
    await clock.fireDue();
    expect(world.engine.state.schedules[schedule.id]?.runs).toEqual([]);

    const wake = (schedule.nextRunAt ?? 0) + 7 * 24 * 60 * MINUTE;
    setSystemTime(wake);
    await clock.fireDue();
    await clock.fireDue();
    const fired = world.engine.state.schedules[schedule.id];
    expect(fired?.runs.map((run) => [run.outcome, run.at])).toEqual([['sent', wake]]);
    expect(fired?.nextRunAt).toBe(wake + 10 * MINUTE);
  });

  test('re-reads each schedule before firing it, so one changed by an earlier fire is left alone', async () => {
    setSystemTime(START);
    const world = await createWorld();
    const first = await addSchedule(world, { kind: 'interval', everyMinutes: 1 });
    const second = await addSchedule(world, { kind: 'interval', everyMinutes: 1 }, { text: 'Second.' });
    setSystemTime((second.nextRunAt ?? 0) + MINUTE);
    const dispatch = world.engine.dispatch.bind(world.engine);
    const sent: string[] = [];
    world.engine.dispatch = async (command, options) => {
      sent.push(command.type);
      const events = await dispatch(command, options);
      if (command.type === 'schedule.fire' && command.scheduleId === first.id) {
        await dispatch({ type: 'schedule.enable', scheduleId: second.id, enabled: false });
      }
      return events;
    };
    await new ScheduleClock(world.engine).fireDue();
    expect(sent).toEqual(['schedule.fire']);
    expect(world.engine.state.schedules[second.id]?.runs).toEqual([]);
  });

  test('a fire that cannot be applied still records a failed run and moves on', async () => {
    const state = createState();
    const schedule = {
      id: 's1',
      enabled: true,
      nextRunAt: 1_000,
    } as Schedule;
    state.schedules.s1 = schedule;
    state.schedules.s2 = { ...schedule, id: 's2' };
    const sent: { command: ShinsaCommand; id: string | undefined }[] = [];
    let refusals = [new DomainError('task_settled', 'This task is finished.'), new Error('disk full')];
    const engine = {
      state,
      subscribe: () => () => undefined,
      dispatch: (command: ShinsaCommand, options: { id?: string } = {}) => {
        sent.push({ command, id: options.id });
        const [refusal, ...rest] = refusals;
        if (command.type === 'schedule.fire' && refusal) {
          refusals = rest;
          return Promise.reject(refusal);
        }
        return Promise.resolve([]);
      },
    } as unknown as Engine;
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    await new ScheduleClock(engine, { now: () => 2_000 }).fireDue();
    warn.mockRestore();
    expect(sent).toEqual([
      { command: { type: 'schedule.fire', scheduleId: 's1', dueAt: 1_000 }, id: 'schedule:s1:1000' },
      {
        command: {
          type: 'schedule.fail',
          scheduleId: 's1',
          dueAt: 1_000,
          deliveryId: null,
          detail: 'This task is finished.',
        },
        id: 'schedule:s1:1000:fail',
      },
      { command: { type: 'schedule.fire', scheduleId: 's2', dueAt: 1_000 }, id: 'schedule:s2:1000' },
      {
        command: {
          type: 'schedule.fail',
          scheduleId: 's2',
          dueAt: 1_000,
          deliveryId: null,
          detail: 'Shinsa could not run it.',
        },
        id: 'schedule:s2:1000:fail',
      },
    ]);
  });

  test('a fire the engine answers with nothing is not sent again until the schedule changes', async () => {
    setSystemTime(START);
    const world = await createWorld();
    const schedule = await addSchedule(world, { kind: 'interval', everyMinutes: 10 });
    const fires: (number | null)[] = [];
    const dispatch = world.engine.dispatch.bind(world.engine);
    world.engine.dispatch = (command, options) => {
      if (command.type === 'schedule.fire') fires.push(command.dueAt);
      return dispatch(command, options);
    };
    let clockNow = (schedule.nextRunAt ?? 0) + 1;
    const clock = new ScheduleClock(world.engine, { now: () => clockNow });
    await clock.fireDue();
    await clock.fireDue();
    expect(fires).toEqual([schedule.nextRunAt]);

    setSystemTime(START + MINUTE);
    await world.engine.dispatch({ type: 'schedule.enable', scheduleId: schedule.id, enabled: false });
    await world.engine.dispatch({ type: 'schedule.enable', scheduleId: schedule.id, enabled: true });
    const changed = world.engine.state.schedules[schedule.id];
    clockNow = (changed?.nextRunAt ?? 0) + 1;
    await clock.fireDue();
    await clock.fireDue();
    expect(fires).toEqual([schedule.nextRunAt, changed?.nextRunAt ?? null]);
  });

  test('arms a timer for the earliest due schedule, follows changes, and stops cleanly', async () => {
    setSystemTime(START);
    const world = await createWorld();
    const schedule = await addSchedule(world, { kind: 'interval', everyMinutes: 1 });
    const clock = new ScheduleClock(world.engine, { minDelayMs: 0, maxDelayMs: 5 });
    clock.start();
    clock.start();
    setSystemTime((schedule.nextRunAt ?? 0) + 1);
    await until('the fire', () => (world.engine.state.schedules[schedule.id]?.runs.length ?? 0) === 1);
    await world.engine.dispatch({ type: 'schedule.remove', scheduleId: schedule.id });
    clock.stop();
    clock.stop();
    expect(world.engine.state.schedules).toEqual({});
  });

  test('a failing pass is logged', async () => {
    const state = createState();
    state.schedules.s1 = { id: 's1', enabled: true, nextRunAt: 0 } as Schedule;
    const engine = {
      state,
      subscribe: () => () => undefined,
      dispatch: () => Promise.reject(new Error('gone')),
    } as unknown as Engine;
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const clock = new ScheduleClock(engine, { minDelayMs: 0 });
    clock.start();
    await until('the warning', () =>
      warn.mock.calls.some(([message]) => message === '[Schedules] Could not run the due schedules')
    );
    clock.stop();
    warn.mockRestore();
  });
});
