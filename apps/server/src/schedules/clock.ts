import { DomainError, type ShinsaState } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { type ClockEntry, StateClock, type StateClockOptions } from '../runtime/clock.ts';
import type { Engine } from '../runtime/engine.ts';

export class ScheduleClock extends StateClock {
  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(
      engine,
      {
        area: 'Schedules',
        failure: 'Could not run the due schedules',
        minDelayMs: 1_000,
        maxDelayMs: 60 * 60 * 1000,
      },
      options
    );
  }

  protected listEntries(state: ShinsaState): ClockEntry[] {
    return Object.values(state.schedules).flatMap((schedule) => {
      if (!schedule.enabled || schedule.nextRunAt === null) return [];
      const id = `schedule:${schedule.id}:${schedule.nextRunAt}:${schedule.updatedAt}`;
      const fire = async () => {
        const events = await this.#fire(schedule.id);
        if (events?.length === 0) this.refuse(id);
      };
      return [{ id, dueAt: schedule.nextRunAt, fire }];
    });
  }

  async #fire(scheduleId: string) {
    const current = this.engine.state.schedules[scheduleId];
    if (!current?.enabled || current.nextRunAt === null || current.nextRunAt > this.now()) return null;
    const dueAt = current.nextRunAt;
    const id = `schedule:${scheduleId}:${dueAt}`;
    try {
      return await this.engine.dispatch({ type: 'schedule.fire', scheduleId, dueAt }, { id });
    } catch (error) {
      log.warn('[Schedules] A schedule could not run; recording the failure', {
        scheduleId,
        error: describeError(error),
      });
      const detail = error instanceof DomainError ? error.message : 'Shinsa could not run it.';
      return await this.engine.dispatch(
        { type: 'schedule.fail', scheduleId, dueAt, deliveryId: null, detail },
        { id: `${id}:fail` }
      );
    }
  }
}
