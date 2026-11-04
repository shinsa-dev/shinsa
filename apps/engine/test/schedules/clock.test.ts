import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { createState, DomainError, type Schedule } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import type { EngineCore } from '../../src/runtime/engine/service.ts';
import { ScheduleClock } from '../../src/schedules/clock/service.ts';
import { captureLogs, until } from '../helpers/index.ts';
import { createFakeEngineCore, openClock, type ServicesOptions } from '../runtime/harness.ts';
import { addSchedule, createWorld } from './fixtures.ts';
import { createClockTimings } from './harness.ts';

const MINUTE = 60_000;

const START = Date.parse('2026-10-23T12:00:00Z');

const open: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
  setSystemTime();
});

async function openSchedule(
  engine: EngineCore['Service'],
  options: ServicesOptions & { timings?: { minDelayMs: number; maxDelayMs: number } } = { liveClock: true }
) {
  const { timings, ...rest } = options;
  const layer = ScheduleClock.layer.pipe(Layer.provide(timings ? createClockTimings(timings) : Layer.empty));
  const clock = await openClock(ScheduleClock, layer, engine, rest);
  open.push(clock);
  return clock;
}

describe('the schedule clock', () => {
  test('fires a due schedule once under its slot’s id, and a missed run once on wake', async () => {
    setSystemTime(START);
    const world = await createWorld();
    const schedule = await addSchedule(world, { kind: 'interval', everyMinutes: 10 });
    const clock = await openSchedule(world.engine.core);
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
    const core = world.engine.core;
    const sent: string[] = [];
    const clock = await openSchedule({
      ...core,
      dispatch: (command, options) =>
        Effect.gen(function* () {
          sent.push(command.type);
          const events = yield* core.dispatch(command, options);
          if (command.type === 'schedule.fire' && command.scheduleId === first.id) {
            yield* core.dispatch({ type: 'schedule.enable', scheduleId: second.id, enabled: false });
          }
          return events;
        }),
    });
    await clock.fireDue();
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
    let refusals = [
      new DomainError({ code: 'task_settled', message: 'This task is finished.' }),
      new EngineStopped({ message: 'disk full' }),
    ];
    const fake = createFakeEngineCore(state, (command) => {
      const [refusal, ...rest] = refusals;
      if (command.type === 'schedule.fire' && refusal) {
        refusals = rest;
        return refusal;
      }
      return [];
    });
    const logs = captureLogs();
    try {
      await (await openSchedule(fake.core, { now: 2_000 })).fireDue();
    } finally {
      logs.restore();
    }
    expect(logs.fieldsOf('[Schedules] A schedule could not run; recording the failure')).toEqual([
      { scheduleId: 's1', error: 'This task is finished.' },
      { scheduleId: 's2', error: 'disk full' },
    ]);
    expect(fake.sent).toEqual([
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
    const core = world.engine.core;
    const clock = await openSchedule(
      {
        ...core,
        dispatch: (command, options) => {
          if (command.type === 'schedule.fire') fires.push(command.dueAt);
          return core.dispatch(command, options);
        },
      },
      { now: (schedule.nextRunAt ?? 0) + 1 }
    );
    await clock.fireDue();
    await clock.fireDue();
    expect(fires).toEqual([schedule.nextRunAt]);

    setSystemTime(START + MINUTE);
    await world.engine.dispatch({ type: 'schedule.enable', scheduleId: schedule.id, enabled: false });
    await world.engine.dispatch({ type: 'schedule.enable', scheduleId: schedule.id, enabled: true });
    const changed = world.engine.state.schedules[schedule.id];
    await clock.setTime((changed?.nextRunAt ?? 0) + 1);
    await clock.fireDue();
    await clock.fireDue();
    expect(fires).toEqual([schedule.nextRunAt, changed?.nextRunAt ?? null]);
  });

  test('arms a timer for the earliest due schedule, follows changes, and stops cleanly', async () => {
    setSystemTime(START);
    const world = await createWorld();
    const schedule = await addSchedule(world, { kind: 'interval', everyMinutes: 1 });
    const clock = await openSchedule(world.engine.core, {
      liveClock: true,
      timings: { minDelayMs: 0, maxDelayMs: 5 },
    });
    await clock.start();
    await clock.start();
    setSystemTime((schedule.nextRunAt ?? 0) + 1);
    await until('the fire', () => (world.engine.state.schedules[schedule.id]?.runs.length ?? 0) === 1);
    await world.engine.dispatch({ type: 'schedule.remove', scheduleId: schedule.id });
    await clock.stop();
    await clock.stop();
    expect(world.engine.state.schedules).toEqual({});
  });

  test('a failing pass is logged', async () => {
    const state = createState();
    state.schedules.s1 = { id: 's1', enabled: true, nextRunAt: 0 } as Schedule;
    const fake = createFakeEngineCore(state, () => new EngineStopped({ message: 'gone' }));
    const logs = captureLogs();
    try {
      const clock = await openSchedule(fake.core, { now: 0, timings: { minDelayMs: 0, maxDelayMs: 5 } });
      await clock.start();
      await clock.adjust(1);
      expect(logs.fieldsOf('[Schedules] Could not run the due schedules')).toEqual([{ error: 'gone' }]);
    } finally {
      logs.restore();
    }
  });
});
