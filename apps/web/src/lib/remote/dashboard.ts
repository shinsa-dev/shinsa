import {
  type ConnectResponse,
  type PairApproveResponse,
  type PairView,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteSession,
  resolveInstanceConnectPath,
  resolveInstanceRemovePath,
  resolvePairApprovePath,
  resolvePairPath,
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
        : `shinsa.dev/app answered ${response.status}.`;
    return new DashboardError(code, message, response.status);
  } catch {
    return new DashboardError('failed', `shinsa.dev/app answered ${response.status}.`, response.status);
  }
}

export function resolveSignInUrl(returnPath: string) {
  return `${REMOTE_PATHS.signIn}?return=${encodeURIComponent(returnPath)}`;
}

export function createDashboardClient(fetchApi: Fetch = (input, init) => fetch(input, init)) {
  async function call<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
    let response: Response;
    try {
      response = await fetchApi(path, {
        method,
        credentials: 'same-origin',
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
      });
    } catch {
      throw new DashboardError('offline', 'Couldn’t reach shinsa.dev/app.', 0);
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
    readPair: (claimCode: string) => call<PairView>(resolvePairPath(claimCode)),
    approvePair: (claimCode: string) => call<PairApproveResponse>(resolvePairApprovePath(claimCode), 'POST'),
    signOut: () => call<{ ok: true }>(REMOTE_PATHS.signOut, 'POST'),
  };
}

export type DashboardClient = ReturnType<typeof createDashboardClient>;
