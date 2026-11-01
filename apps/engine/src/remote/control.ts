import {
  type HeartbeatRequest,
  type HeartbeatResponse,
  type InviteCreateResponse,
  type PairPollRequest,
  type PairPollResponse,
  type PairStartRequest,
  type PairStartResponse,
  REMOTE_APP_ORIGIN,
  REMOTE_PATHS,
  type RemoteMember,
  type RemoteUser,
  resolveMachineTeamPath,
  type TeamAction,
  type TeamCreateResponse,
  type TeamJoinResponse,
} from '@shinsa/core';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const CONTROL_TIMEOUT_MS = 15_000;

const OFFLINE_TIMEOUT_MS = 2_000;

export class RevokedError extends Error {
  constructor() {
    super('This machine was removed from remote access. Turn remote access on again to pair it.');
    this.name = 'RevokedError';
  }
}

export class ControlError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`Shinsa Cloud answered ${path} with status ${status}.`);
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

  recordHeartbeat(machineToken: string, request: HeartbeatRequest) {
    return this.#post<HeartbeatResponse>(REMOTE_PATHS.heartbeat, request, machineToken);
  }

  requestInvite(machineToken: string) {
    return this.#post<InviteCreateResponse>(REMOTE_PATHS.machineInvites, {}, machineToken);
  }

  async requestInviteRemoval(machineToken: string) {
    await this.#post(REMOTE_PATHS.machineInviteRemove, {}, machineToken);
  }

  requestRequester(machineToken: string, userId: string) {
    return this.#post<RemoteUser>(REMOTE_PATHS.machineRequester, { userId }, machineToken);
  }

  requestMemberAddition(machineToken: string, userId: string) {
    return this.#post<RemoteMember>(REMOTE_PATHS.machineMemberAdd, { userId }, machineToken);
  }

  async requestMemberRemoval(machineToken: string, userId: string) {
    await this.#post(REMOTE_PATHS.machineMemberRemove, { userId }, machineToken);
  }

  requestHandoff(machineToken: string) {
    return this.#post<InviteCreateResponse>(REMOTE_PATHS.machineHandoffs, {}, machineToken);
  }

  async requestHandoffRemoval(machineToken: string, token: string) {
    await this.#post(REMOTE_PATHS.machineHandoffRemove, { token }, machineToken);
  }

  requestGuestAddition(machineToken: string, userId: string) {
    return this.#post<RemoteMember>(REMOTE_PATHS.machineGuestAdd, { userId }, machineToken);
  }

  async requestGuestRemoval(machineToken: string, userId: string) {
    await this.#post(REMOTE_PATHS.machineGuestRemove, { userId }, machineToken);
  }

  requestTeamCreation(machineToken: string, name: string) {
    return this.#post<TeamCreateResponse>(REMOTE_PATHS.machineTeams, { name }, machineToken);
  }

  requestTeamJoin(machineToken: string, invite: string) {
    return this.#post<TeamJoinResponse>(REMOTE_PATHS.machineTeamJoin, { invite }, machineToken);
  }

  requestTeamAction<T>(machineToken: string, teamId: string, action: TeamAction, body: object = {}) {
    return this.#post<T>(resolveMachineTeamPath(teamId, action), body, machineToken);
  }

  async recordOffline(machineToken: string) {
    await this.#post(REMOTE_PATHS.offline, {}, machineToken, OFFLINE_TIMEOUT_MS);
  }

  async requestRemoval(machineToken: string) {
    await this.#post(REMOTE_PATHS.machineRemove, {}, machineToken);
  }
}
