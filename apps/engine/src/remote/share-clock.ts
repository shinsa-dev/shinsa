import type { ShinsaState } from '@shinsa/core';
import { type ClockEntry, StateClock, type StateClockOptions } from '../runtime/clock.ts';
import type { Engine } from '../runtime/engine.ts';

export class ShareClock extends StateClock {
  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(
      engine,
      { area: 'Share', failure: 'Could not end a share that ran out', minDelayMs: 1_000 },
      options
    );
  }

  protected listEntries(state: ShinsaState): ClockEntry[] {
    return Object.values(state.tasks).flatMap((task) => {
      const dueAt = task.share?.endsAt ?? null;
      if (dueAt === null) return [];
      const id = `share:${task.id}:${dueAt}`;
      const fire = async () => {
        const events = await this.engine.dispatch({ type: 'share.expire', taskId: task.id }, { id });
        if (events.length === 0) this.refuse(id);
      };
      return [{ id, dueAt, fire }];
    });
  }
}
