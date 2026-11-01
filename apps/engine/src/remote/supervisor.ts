import type { MachineCredentials, RemoteAccess, RemoteMember, RemoteTeam, TunnelStatus } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { type ControlClient, RevokedError } from './control.ts';
import { readAccess, readGuests, readTeams } from './store.ts';

export type { TunnelStatus } from '@shinsa/core';

export interface TunnelConnector {
  exited: Promise<unknown>;
  stop: () => void;
}

export type StartConnector = (tunnelToken: string, localUrl: string) => Promise<TunnelConnector>;

export interface TunnelTimings {
  pingMs: number;
  heartbeatEvery: number;
  failedPingsBeforeRestart: number;
  quickRetryWindowMs: number;
  quickRetryMs: number;
  backoffMs: readonly number[];
}

export const TUNNEL_TIMINGS: TunnelTimings = {
  pingMs: 30_000,
  heartbeatEvery: 4,
  failedPingsBeforeRestart: 3,
  quickRetryWindowMs: 60_000,
  quickRetryMs: 1_000,
  backoffMs: [2_000, 4_000, 10_000, 30_000],
};

export interface TunnelSupervisorOptions {
  control: Pick<ControlClient, 'recordHeartbeat' | 'recordOffline'>;
  connect: StartConnector;
  ping: (url: string) => Promise<boolean>;
  localUrl: () => string;
  version: string;
  onRevoked: () => void;
  onAccess?: (access: RemoteAccess, guests: RemoteMember[]) => void;
  onTeams?: (teams: RemoteTeam[]) => void;
  timings?: TunnelTimings;
  now?: () => number;
}

export function resolveRestartDelay(timings: TunnelTimings, streakMs: number, lateAttempts: number) {
  if (streakMs < timings.quickRetryWindowMs) return timings.quickRetryMs;
  const index = Math.min(lateAttempts, timings.backoffMs.length - 1);
  return timings.backoffMs[index] ?? timings.quickRetryMs;
}

export class TunnelSupervisor {
  readonly #options: TunnelSupervisorOptions;
  readonly #timings: TunnelTimings;
  readonly #now: () => number;
  readonly #listeners = new Set<(status: TunnelStatus) => void>();
  #status: TunnelStatus = 'off';
  #credentials: MachineCredentials | null = null;
  #connector: TunnelConnector | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #pings = 0;
  #failedPings = 0;
  #streakStartedAt: number | null = null;
  #lateAttempts = 0;

  constructor(options: TunnelSupervisorOptions) {
    this.#options = options;
    this.#timings = options.timings ?? TUNNEL_TIMINGS;
    this.#now = options.now ?? Date.now;
  }

  get status() {
    return this.#status;
  }

  subscribe(listener: (status: TunnelStatus) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(credentials: MachineCredentials) {
    this.#halt();
    this.#credentials = credentials;
    this.#streakStartedAt = null;
    this.#lateAttempts = 0;
    void this.#connect(this.#generation, 'starting');
  }

  async requestHeartbeat() {
    await this.#heartbeat(this.#generation);
  }

  async stop() {
    const credentials = this.#credentials;
    const wasRunning = this.#status !== 'off' && this.#status !== 'revoked';
    this.#halt();
    this.#credentials = null;
    this.#updateStatus('off');
    if (!(credentials && wasRunning)) return;
    try {
      await this.#options.control.recordOffline(credentials.machineToken);
    } catch (error) {
      log.warn('[Remote] Could not mark this machine offline', { error: describeError(error) });
    }
  }

  #halt() {
    this.#generation += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#connector?.stop();
    this.#connector = null;
  }

  #updateStatus(status: TunnelStatus) {
    if (status === this.#status) return;
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
  }

  #isCurrent(generation: number) {
    return generation === this.#generation;
  }

  #schedule(generation: number, delayMs: number, step: () => Promise<void>) {
    if (!this.#isCurrent(generation)) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#isCurrent(generation)) void step();
    }, delayMs);
  }

  async #connect(generation: number, status: TunnelStatus) {
    const credentials = this.#credentials;
    if (!credentials) return;
    this.#updateStatus(status);
    let connector: TunnelConnector;
    try {
      connector = await this.#options.connect(credentials.tunnelToken, this.#options.localUrl());
    } catch (error) {
      log.warn('[Remote] The tunnel did not connect', { error: describeError(error) });
      this.#restart(generation);
      return;
    }
    if (!this.#isCurrent(generation)) {
      connector.stop();
      return;
    }
    this.#connector = connector;
    this.#pings = 0;
    this.#failedPings = 0;
    void connector.exited.then(() => {
      if (!this.#isCurrent(generation) || this.#connector !== connector) return;
      log.warn('[Remote] The tunnel stopped; starting it again');
      this.#restart(generation);
    });
    if (!(await this.#heartbeat(generation))) return;
    this.#updateStatus('connected');
    this.#schedule(generation, this.#timings.pingMs, () => this.#ping(generation));
  }

  async #heartbeat(generation: number) {
    const credentials = this.#credentials;
    if (!credentials) return false;
    try {
      const answer = await this.#options.control.recordHeartbeat(credentials.machineToken, {
        localUrl: this.#options.localUrl(),
        version: this.#options.version,
      });
      const access = readAccess(answer);
      const teams = readTeams(answer.teams);
      if (access && this.#isCurrent(generation)) this.#options.onAccess?.(access, readGuests(answer));
      if (teams && this.#isCurrent(generation)) this.#options.onTeams?.(teams);
    } catch (error) {
      if (error instanceof RevokedError) {
        this.#revoke(generation);
        return false;
      }
      log.warn('[Remote] The heartbeat failed', { error: describeError(error) });
    }
    return this.#isCurrent(generation);
  }

  #revoke(generation: number) {
    if (!this.#isCurrent(generation)) return;
    log.warn('[Remote] Shinsa Cloud removed this machine; remote access is off');
    this.#halt();
    this.#credentials = null;
    this.#updateStatus('revoked');
    this.#options.onRevoked();
  }

  async #ping(generation: number) {
    const credentials = this.#credentials;
    if (!credentials) return;
    const ok = await this.#options.ping(`https://${credentials.tunnelHost}/health`).catch(() => false);
    if (!this.#isCurrent(generation)) return;
    if (!ok) {
      this.#failedPings += 1;
      if (this.#failedPings >= this.#timings.failedPingsBeforeRestart) {
        this.#restart(generation);
        return;
      }
    } else {
      this.#failedPings = 0;
      this.#streakStartedAt = null;
      this.#lateAttempts = 0;
      this.#pings += 1;
      if (this.#pings % this.#timings.heartbeatEvery === 0 && !(await this.#heartbeat(generation))) return;
    }
    this.#schedule(generation, this.#timings.pingMs, () => this.#ping(generation));
  }

  #restart(generation: number) {
    if (!this.#isCurrent(generation)) return;
    this.#connector?.stop();
    this.#connector = null;
    const now = this.#now();
    this.#streakStartedAt ??= now;
    const streakMs = now - this.#streakStartedAt;
    const delay = resolveRestartDelay(this.#timings, streakMs, this.#lateAttempts);
    if (streakMs >= this.#timings.quickRetryWindowMs) this.#lateAttempts += 1;
    this.#updateStatus('reconnecting');
    this.#schedule(generation, delay, () => this.#connect(generation, 'reconnecting'));
  }
}
