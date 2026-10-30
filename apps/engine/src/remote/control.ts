import {
  type HeartbeatRequest,
  type PairPollRequest,
  type PairPollResponse,
  type PairStartRequest,
  type PairStartResponse,
  REMOTE_APP_ORIGIN,
  REMOTE_PATHS,
} from '@shinsa/core';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const CONTROL_TIMEOUT_MS = 15_000;

const OFFLINE_TIMEOUT_MS = 2_000;

export class RevokedError extends Error {
  constructor() {
    super('This Mac was removed from remote access. Turn remote access on again to pair it.');
    this.name = 'RevokedError';
  }
}

export class ControlError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`shinsa.dev/app answered ${path} with status ${status}.`);
    this.name = 'ControlError';
    this.status = status;
  }
}

export interface ControlClientOptions {
  origin?: string;
  fetch?: Fetch;
}

export class ControlClient {
  readonly origin: string;
  readonly #fetch: Fetch;

  constructor(options: ControlClientOptions = {}) {
    this.origin = options.origin ?? REMOTE_APP_ORIGIN;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async #post<T>(path: string, body: unknown, token: string | null, timeoutMs = CONTROL_TIMEOUT_MS) {
    const response = await this.#fetch(`${this.origin}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 && token) throw new RevokedError();
    if (!response.ok) throw new ControlError(path, response.status);
    return (await response.json()) as T;
  }

  requestPairStart(request: PairStartRequest) {
    return this.#post<PairStartResponse>(REMOTE_PATHS.pairStart, request, null);
  }

  requestPairPoll(request: PairPollRequest) {
    return this.#post<PairPollResponse>(REMOTE_PATHS.pairPoll, request, null);
  }

  async recordHeartbeat(machineToken: string, request: HeartbeatRequest) {
    await this.#post(REMOTE_PATHS.heartbeat, request, machineToken);
  }

  async recordOffline(machineToken: string) {
    await this.#post(REMOTE_PATHS.offline, {}, machineToken, OFFLINE_TIMEOUT_MS);
  }

  async requestRemoval(machineToken: string) {
    await this.#post(REMOTE_PATHS.machineRemove, {}, machineToken);
  }
}
