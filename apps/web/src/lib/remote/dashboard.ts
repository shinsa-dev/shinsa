import {
  type AccessScopes,
  ClaimCode,
  InstanceId,
  REMOTE_PATHS,
  TeamId,
  TeamScopesRequest,
} from '@shinsa/core';
import { Effect, Schema } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { CLOUD_NOT_FOUND, CloudRefused } from '@/lib/runtime/remote/schema.ts';
import { RemoteClient } from '@/lib/runtime/remote/service.ts';

const SIGN_IN_ERRORS: Record<string, string> = {
  sign_in_failed: 'GitHub did not finish the sign-in. Try again.',
};

export function describeSignInError(code: string) {
  return SIGN_IN_ERRORS[code] ?? 'Signing in did not work. Try again.';
}

export function resolveSignInUrl(returnPath: string) {
  return `${REMOTE_PATHS.signIn}?return=${encodeURIComponent(returnPath)}`;
}

export function isMachineGone(error: unknown) {
  return error instanceof CloudRefused && error.status === CLOUD_NOT_FOUND.status;
}

export function createDashboardClient() {
  const notFound = new CloudRefused(CLOUD_NOT_FOUND);
  const decodeInstanceId = Schema.decodeUnknownEffect(InstanceId);
  const decodeClaimCode = Schema.decodeUnknownEffect(ClaimCode);
  const decodeTeamId = Schema.decodeUnknownEffect(TeamId);
  const decodeScopesRequest = Schema.decodeUnknownEffect(TeamScopesRequest);
  const call = <A, E>(pick: (remote: RemoteClient['Service']) => Effect.Effect<A, E>) =>
    runApp(
      Effect.gen(function* () {
        return yield* pick(yield* RemoteClient);
      })
    );
  const onInstance = <A, E>(
    id: string,
    pick: (remote: RemoteClient['Service'], params: { instanceId: InstanceId }) => Effect.Effect<A, E>
  ) =>
    call((remote) =>
      decodeInstanceId(id).pipe(
        Effect.mapError(() => notFound),
        Effect.flatMap((instanceId) => pick(remote, { instanceId }))
      )
    );
  const onClaim = <A, E>(
    code: string,
    pick: (remote: RemoteClient['Service'], params: { claimCode: ClaimCode }) => Effect.Effect<A, E>
  ) =>
    call((remote) =>
      decodeClaimCode(code).pipe(
        Effect.mapError(() => notFound),
        Effect.flatMap((claimCode) => pick(remote, { claimCode }))
      )
    );

  return {
    readSession: () => call((remote) => remote.session.read()),
    listInstances: () => call((remote) => remote.instances.list()),
    requestConnect: (instanceId: string) =>
      onInstance(instanceId, (remote, params) => remote.instances.connect({ params })),
    removeInstance: (instanceId: string) =>
      onInstance(instanceId, (remote, params) => remote.instances.remove({ params })),
    leaveInstance: (instanceId: string) =>
      onInstance(instanceId, (remote, params) => remote.instances.leave({ params })),
    acceptInvite: (token: string) => call((remote) => remote.instances.inviteAccept({ payload: { token } })),
    acceptHandoff: (token: string) =>
      call((remote) => remote.instances.handoffAccept({ payload: { token } })),
    listTeams: () => call((remote) => remote.teams.list()),
    joinTeam: (invite: string) => call((remote) => remote.teams.join({ payload: { invite } })),
    updateTeamScopes: (teamId: string, userId: string | null, scopes: AccessScopes | null) =>
      call((remote) =>
        Effect.all([
          decodeTeamId(teamId),
          decodeScopesRequest(userId === null ? { scopes } : { userId, scopes }),
        ]).pipe(
          Effect.mapError(() => notFound),
          Effect.flatMap(([id, payload]) => remote.teams.scopes({ params: { teamId: id }, payload }))
        )
      ),
    previewTeam: (invite: string) => call((remote) => remote.teams.preview({ payload: { invite } })),
    readPair: (claimCode: string) => onClaim(claimCode, (remote, params) => remote.pairs.view({ params })),
    approvePair: (claimCode: string) =>
      onClaim(claimCode, (remote, params) => remote.pairs.approve({ params })),
    signOut: () => call((remote) => remote.session.signOut()),
  };
}

export type DashboardClient = ReturnType<typeof createDashboardClient>;
