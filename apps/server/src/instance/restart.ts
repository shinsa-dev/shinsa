import { DomainError, type EngineRestartWhen, listLiveRuns, type ShinsaState } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { ServiceControl } from '../service/index.ts';

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

export function createServiceRestarter(
  source: RestartSource,
  service: Pick<ServiceControl, 'status' | 'restart'>,
  platform: string = process.platform,
  pid: number = process.pid
) {
  return new EngineRestarter(source, {
    isService: async () => {
      if (platform !== 'darwin') return false;
      const status = await service.status();
      return status.server?.pid === pid && status.server.service;
    },
    restart: () => service.restart(),
  });
}
