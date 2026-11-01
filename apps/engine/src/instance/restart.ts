import { DomainError, type EngineRestartWhen, listLiveRuns, type ShinsaState } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { EngineActivity } from './install.ts';

interface RestartSource {
  readonly state: ShinsaState;
  subscribe: (listener: (state: ShinsaState) => void) => () => void;
}

export interface RestartDrain {
  holdNewRuns: (onHeld: () => void) => void;
  releaseHeldRuns: () => void;
  isHeld: (runId: string) => boolean;
}

export interface EngineRestartOptions {
  isService: () => Promise<boolean>;
  restart: () => Promise<unknown>;
  drain?: RestartDrain;
  drainMs?: number;
  now?: () => number;
  schedule?: (run: () => void) => void;
}

export type EngineRestartPending = 'idle' | null;

const RESTART_DRAIN_MS = 15 * 60_000;

function countWorkingRuns(state: ShinsaState, isHeld: (runId: string) => boolean) {
  return listLiveRuns(state).filter((run) => run.status === 'running' && !isHeld(run.id)).length;
}

export function isEngineBusy(state: ShinsaState, isHeld: (runId: string) => boolean = () => false) {
  return countWorkingRuns(state, isHeld) > 0;
}

export class EngineRestarter {
  readonly #source: RestartSource;
  readonly #options: EngineRestartOptions;
  #pending: EngineRestartPending = null;
  #deadlineAt: number | null = null;
  #deadline: ReturnType<typeof setTimeout> | null = null;
  #stopWatching: (() => void) | null = null;
  #restarting = false;

  constructor(source: RestartSource, options: EngineRestartOptions) {
    this.#source = source;
    this.#options = options;
  }

  get pending(): EngineRestartPending {
    return this.#pending;
  }

  get deadlineAt() {
    return this.#deadlineAt;
  }

  isHeld(runId: string) {
    return this.#options.drain?.isHeld(runId) ?? false;
  }

  #isBusy(state: ShinsaState) {
    return isEngineBusy(state, (runId) => this.isHeld(runId));
  }

  async request(when: EngineRestartWhen) {
    if (!(await this.#options.isService())) {
      throw new DomainError('restart_unsupported', 'Only a background engine restarts.');
    }
    if (when === 'now' || !this.#isBusy(this.#source.state)) {
      this.#restartSoon();
      return { restarting: true };
    }
    this.#drain();
    return { restarting: false };
  }

  #drain() {
    if (this.#pending) return;
    this.#pending = 'idle';
    this.#options.drain?.holdNewRuns(() => this.#restartWhenIdle());
    const drainMs = this.#options.drainMs ?? RESTART_DRAIN_MS;
    this.#deadlineAt = (this.#options.now ?? Date.now)() + drainMs;
    this.#deadline = setTimeout(() => {
      log.info('[Engine] Agents still work past the restart deadline; their runs resume after it');
      this.#restartSoon();
    }, drainMs);
    this.#deadline.unref?.();
    this.#stopWatching = this.#source.subscribe(() => this.#restartWhenIdle());
  }

  #restartWhenIdle() {
    if (!this.#isBusy(this.#source.state)) this.#restartSoon();
  }

  #endDrain() {
    if (this.#deadline) clearTimeout(this.#deadline);
    this.#deadline = null;
    this.#deadlineAt = null;
    this.#stopWatching?.();
    this.#stopWatching = null;
  }

  #restartSoon() {
    if (this.#restarting) return;
    this.#restarting = true;
    this.#endDrain();
    const schedule = this.#options.schedule ?? ((run: () => void) => setTimeout(run, 250));
    schedule(() => {
      log.info('[Engine] Restarting into the version the app carries');
      this.#options.restart().catch((error: unknown) => {
        this.#restarting = false;
        this.#release();
        log.error('[Engine] Could not restart', { error: describeError(error) });
      });
    });
  }

  #release() {
    if (!this.#pending) return;
    this.#pending = null;
    this.#options.drain?.releaseHeldRuns();
  }
}

export function resolveEngineActivity(state: ShinsaState, restarter?: EngineRestarter): EngineActivity {
  const working = countWorkingRuns(state, (runId) => restarter?.isHeld(runId) ?? false);
  return {
    busy: working > 0,
    working,
    restart: restarter?.pending ?? null,
    restartBy: restarter?.deadlineAt ?? null,
  };
}

export const EXIT_RESTART = 75;

export const STOP_DEADLINE_MS = 30_000;

export type StopOutcome = 'stopped' | 'failed' | 'timed_out';

export async function stopWithin(
  stop: () => Promise<void>,
  deadlineMs = STOP_DEADLINE_MS
): Promise<StopOutcome> {
  const deadline = Promise.withResolvers<StopOutcome>();
  const timer = setTimeout(() => deadline.resolve('timed_out'), deadlineMs);
  const stopping = stop().then(
    () => 'stopped' as const,
    (error: unknown) => {
      log.error('[Engine] Could not stop cleanly', { error: describeError(error) });
      return 'failed' as const;
    }
  );
  try {
    const outcome = await Promise.race([stopping, deadline.promise]);
    if (outcome === 'timed_out') {
      log.error('[Engine] Did not stop in time, so it exits anyway', { deadlineMs });
    }
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}

export interface ServiceRestart {
  byService: boolean;
  stop: () => Promise<void>;
  drain?: RestartDrain;
  exit?: (code: number) => void;
  deadlineMs?: number;
}

export function createServiceRestarter(source: RestartSource, service: ServiceRestart) {
  const exit = service.exit ?? ((code: number) => process.exit(code));
  return new EngineRestarter(source, {
    isService: () => Promise.resolve(service.byService),
    drain: service.drain,
    restart: async () => {
      await stopWithin(service.stop, service.deadlineMs);
      exit(EXIT_RESTART);
    },
  });
}
