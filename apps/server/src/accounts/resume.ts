import type { ShinsaState, UsageWait } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { type ClockEntry, StateClock, type StateClockOptions } from '../runtime/clock.ts';
import type { Engine } from '../runtime/engine.ts';

export interface UsageResumeClockOptions extends StateClockOptions {
  graceMs?: number;
  retryMs?: number;
}

export function resolveResumeCommandId(taskId: string, wait: UsageWait) {
  return `usage-resume:${taskId}:${wait.runId}:${wait.resetAt}:${wait.id}`;
}

export class UsageResumeClock extends StateClock {
  readonly #graceMs: number;
  readonly #retryMs: number;
  readonly #triedAt = new Map<string, number>();

  constructor(engine: Engine, options: UsageResumeClockOptions = {}) {
    super(engine, { area: 'Accounts', failure: 'Could not resume a waiting task', minDelayMs: 0 }, options);
    this.#graceMs = options.graceMs ?? 5_000;
    this.#retryMs = options.retryMs ?? 60_000;
  }

  protected listEntries(state: ShinsaState): ClockEntry[] {
    const entries = Object.values(state.tasks).flatMap((task) => {
      const wait = task.usageWait;
      if (wait?.status !== 'armed') return [];
      return [{ id: wait.id, dueAt: this.#resolveDueAt(wait), fire: () => this.#resume(task.id, wait) }];
    });
    const live = new Set(entries.map((entry) => entry.id));
    for (const id of this.#triedAt.keys()) if (!live.has(id)) this.#triedAt.delete(id);
    return entries;
  }

  #resolveDueAt(wait: UsageWait) {
    const first = wait.resetAt + this.#graceMs;
    const triedAt = this.#triedAt.get(wait.id);
    return triedAt === undefined ? first : Math.max(first, triedAt + this.#retryMs);
  }

  #resolveAttemptId(taskId: string, wait: UsageWait, now: number) {
    const id = resolveResumeCommandId(taskId, wait);
    const attempt = Math.floor((now - wait.resetAt - this.#graceMs) / this.#retryMs) + 1;
    return attempt === 1 ? id : `${id}:${attempt}`;
  }

  async #resume(taskId: string, wait: UsageWait) {
    const now = this.now();
    this.#triedAt.set(wait.id, now);
    try {
      await this.engine.dispatch(
        { type: 'usage_wait.resume', taskId, waitId: wait.id },
        { id: this.#resolveAttemptId(taskId, wait, now) }
      );
    } catch (error) {
      log.warn('[Accounts] Could not resume a task after the usage limit reset', {
        taskId,
        error: describeError(error),
      });
    }
  }
}
