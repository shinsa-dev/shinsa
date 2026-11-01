import type { ShinsaCommand, ShinsaState } from '@shinsa/core';
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
      const entries: ClockEntry[] = [];
      const shareEndsAt = task.share?.endsAt ?? null;
      if (shareEndsAt !== null)
        entries.push(
          this.#createEntry(`share:${task.id}:${shareEndsAt}`, shareEndsAt, {
            type: 'share.expire',
            taskId: task.id,
          })
        );
      for (const preview of task.previews ?? []) {
        if (preview.endsAt === null) continue;
        const id = `preview:${task.id}:${preview.serviceId}:${preview.endsAt}`;
        const command = { type: 'preview.expire', taskId: task.id, serviceId: preview.serviceId } as const;
        entries.push(this.#createEntry(id, preview.endsAt, command));
      }
      return entries;
    });
  }

  #createEntry(id: string, dueAt: number, command: ShinsaCommand): ClockEntry {
    const fire = async () => {
      const events = await this.engine.dispatch(command, { id });
      if (events.length === 0) this.refuse(id);
    };
    return { id, dueAt, fire };
  }
}
