import {
  type ConnectResponse,
  type InviteAcceptResponse,
  type PairApproveResponse,
  type PairView,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteSession,
  type RemoteTeam,
  resolveInstanceConnectPath,
  resolveInstanceLeavePath,
  resolveInstanceRemovePath,
  resolvePairApprovePath,
  resolvePairPath,
  type TeamJoinResponse,
} from '@shinsa/core';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class DashboardError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'DashboardError';
    this.code = code;
    this.status = status;
  }
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof body.error?.code === 'string' ? body.error.code : 'failed';
    const message =
      typeof body.error?.message === 'string'
        ? body.error.message
        : `Shinsa Cloud answered ${response.status}.`;
    return new DashboardError(code, message, response.status);
  } catch {
    return new DashboardError('failed', `Shinsa Cloud answered ${response.status}.`, response.status);
  }
}

const SIGN_IN_ERRORS: Record<string, string> = {
  sign_in_failed: 'GitHub did not finish the sign-in. Try again.',
};

export function describeSignInError(code: string) {
  return SIGN_IN_ERRORS[code] ?? 'Signing in did not work. Try again.';
}

export function resolveSignInUrl(returnPath: string) {
  return `${REMOTE_PATHS.signIn}?return=${encodeURIComponent(returnPath)}`;
}

export function createDashboardClient(fetchApi: Fetch = (input, init) => fetch(input, init)) {
  async function call<T>(path: string, method: 'GET' | 'POST' = 'GET', body: unknown = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchApi(path, {
        method,
        credentials: 'same-origin',
        ...(method === 'POST'
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
    } catch {
      throw new DashboardError('offline', 'Couldn’t reach Shinsa Cloud.', 0);
    }
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
  }

  return {
    readSession: () => call<RemoteSession>(REMOTE_PATHS.session),
    listInstances: () => call<RemoteInstance[]>(REMOTE_PATHS.instances),
    requestConnect: (instanceId: string) =>
      call<ConnectResponse>(resolveInstanceConnectPath(instanceId), 'POST'),
    removeInstance: (instanceId: string) => call<{ ok: true }>(resolveInstanceRemovePath(instanceId), 'POST'),
    leaveInstance: (instanceId: string) => call<{ ok: true }>(resolveInstanceLeavePath(instanceId), 'POST'),
    acceptInvite: (token: string) => call<InviteAcceptResponse>(REMOTE_PATHS.inviteAccept, 'POST', { token }),
    listTeams: () => call<RemoteTeam[]>(REMOTE_PATHS.teams),
    joinTeam: (invite: string) => call<TeamJoinResponse>(REMOTE_PATHS.teamJoin, 'POST', { invite }),
    readPair: (claimCode: string) => call<PairView>(resolvePairPath(claimCode)),
    approvePair: (claimCode: string) => call<PairApproveResponse>(resolvePairApprovePath(claimCode), 'POST'),
    signOut: () => call<{ ok: true }>(REMOTE_PATHS.signOut, 'POST'),
  };
}

export type DashboardClient = ReturnType<typeof createDashboardClient>;
