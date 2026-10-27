import { DomainError, type EngineRestartWhen, listLiveRuns, type ShinsaState } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';

interface RestartSource {
  readonly state: ShinsaState;
  subscribe: (listener: (state: ShinsaState) => void) => () => void;
}

export interface EngineRestartOptions {
  isService: () => Promise<boolean>;
  restart: () => Promise<unknown>;
  schedule?: (run: () => void) => void;
}

export type EngineRestartPending = 'idle' | null;

export function isEngineBusy(state: ShinsaState) {
  return listLiveRuns(state).some((run) => run.status === 'running');
}

export class EngineRestarter {
  readonly #source: RestartSource;
  readonly #options: EngineRestartOptions;
  #pending: EngineRestartPending = null;
  #stopWatching: (() => void) | null = null;
  #restarting = false;

  constructor(source: RestartSource, options: EngineRestartOptions) {
    this.#source = source;
    this.#options = options;
  }

  get pending(): EngineRestartPending {
    return this.#pending;
  }

  async request(when: EngineRestartWhen) {
    if (!(await this.#options.isService())) {
      throw new DomainError(
        'restart_unsupported',
        'Shinsa restarts its engine only when the engine runs in the background. Stop it and start it again.'
      );
    }
    if (when === 'now' || !isEngineBusy(this.#source.state)) {
      this.#restartSoon();
      return { restarting: true };
    }
    this.#pending = 'idle';
    this.#stopWatching ??= this.#source.subscribe((state) => {
      if (!isEngineBusy(state)) this.#restartSoon();
    });
    return { restarting: false };
  }

  #restartSoon() {
    if (this.#restarting) return;
    this.#restarting = true;
    this.#stopWatching?.();
    this.#stopWatching = null;
    const schedule = this.#options.schedule ?? ((run: () => void) => setTimeout(run, 250));
    schedule(() => {
      log.info('[Engine] Restarting into the version the app carries');
      this.#options.restart().catch((error: unknown) => {
        this.#restarting = false;
        log.error('[Engine] Could not restart', { error: describeError(error) });
      });
    });
  }
}

export const EXIT_RESTART = 75;

export interface LaunchdRestart {
  byService: boolean;
  stop: () => Promise<void>;
  exit?: (code: number) => void;
}

export function createLaunchdRestarter(source: RestartSource, launchd: LaunchdRestart) {
  const exit = launchd.exit ?? ((code: number) => process.exit(code));
  return new EngineRestarter(source, {
    isService: () => Promise.resolve(launchd.byService),
    restart: async () => {
      await launchd.stop();
      exit(EXIT_RESTART);
    },
  });
}
