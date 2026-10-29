import { DomainError, type EngineRestartWhen, listLiveRuns, type ShinsaState } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';

interface RestartSource {
  readonly state: ShinsaState;
  subscribe: (listener: (state: ShinsaState) => void) => () => void;
}

export interface RestartDrain {
  holdNewRuns: () => void;
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

export const RESTART_DRAIN_MS = 15 * 60_000;

export function isEngineBusy(state: ShinsaState, isHeld: (runId: string) => boolean = () => false) {
  return listLiveRuns(state).some((run) => run.status === 'running' && !isHeld(run.id));
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

  #isBusy(state: ShinsaState) {
    const drain = this.#options.drain;
    return isEngineBusy(state, drain ? (runId) => drain.isHeld(runId) : undefined);
  }

  async request(when: EngineRestartWhen) {
    if (!(await this.#options.isService())) {
      throw new DomainError(
        'restart_unsupported',
        'Shinsa restarts its engine only when the engine runs in the background. Stop it and start it again.'
      );
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
    this.#options.drain?.holdNewRuns();
    const drainMs = this.#options.drainMs ?? RESTART_DRAIN_MS;
    this.#deadlineAt = (this.#options.now ?? Date.now)() + drainMs;
    this.#deadline = setTimeout(() => {
      log.info('[Engine] Agents still work past the restart deadline; their runs resume after it');
      this.#restartSoon();
    }, drainMs);
    this.#deadline.unref?.();
    this.#stopWatching = this.#source.subscribe((state) => {
      if (!this.#isBusy(state)) this.#restartSoon();
    });
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

export const EXIT_RESTART = 75;

export interface LaunchdRestart {
  byService: boolean;
  stop: () => Promise<void>;
  drain?: RestartDrain;
  exit?: (code: number) => void;
}

export function createLaunchdRestarter(source: RestartSource, launchd: LaunchdRestart) {
  const exit = launchd.exit ?? ((code: number) => process.exit(code));
  return new EngineRestarter(source, {
    isService: () => Promise.resolve(launchd.byService),
    drain: launchd.drain,
    restart: async () => {
      await launchd.stop();
      exit(EXIT_RESTART);
    },
  });
}
