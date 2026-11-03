import { randomBytes } from 'node:crypto';
import { DomainError, TEAM_SHARE_PRESET } from '@shinsa/core';
import { Effect, Redacted } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { ChannelPeer } from './channel.ts';
import { RemoteClient } from './client/service.ts';
import { ShareChannel } from './share-channel.ts';
import { ShareChannelBroke } from './share-channel/schema.ts';
import {
  TeamCommandFailed,
  TeamHeartbeatFailed,
  type TeamsOptions,
  type TeamSubject,
} from './teams/schema.ts';
import { makeTeams } from './teams/service.ts';

export { TEAM_REFUSALS, TEAM_REMOTE_CHANGED, type TeamSubject, type TeamsOptions } from './teams/schema.ts';

function broke(error: unknown) {
  return new ShareChannelBroke({ message: describeError(error) });
}

export class Teams {
  readonly #handle: Effect.Success<ReturnType<typeof makeTeams>>;

  constructor(options: TeamsOptions) {
    const { engine, remote, shares, held } = options;
    const now = options.now ?? Date.now;
    const random = options.random ?? ((bytes: number) => new Uint8Array(randomBytes(bytes)));
    const client = edgeRuntime.runSync(
      RemoteClient.use((remoteClient) => Effect.succeed(remoteClient)).pipe(
        Effect.provide(remote.control.layer)
      )
    );
    this.#handle = edgeRuntime.runSync(
      makeTeams({
        state: Effect.sync(() => engine.state),
        dispatch: (command) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command),
            catch: (error) =>
              error instanceof DomainError ? error : new TeamCommandFailed({ message: describeError(error) }),
          }).pipe(Effect.asVoid),
        teams: client.teams,
        token: (machineToken) => Redacted.make(machineToken),
        store: {
          file: Effect.sync(() => remote.store.file),
          selectTeam: (teamId) => Effect.sync(() => remote.store.selectTeam(teamId)),
          selectTeamKey: (teamId) => Effect.sync(() => remote.store.selectTeamKey(teamId)),
          selectGrant: (userId) => Effect.sync(() => remote.store.selectGrant(userId)),
          recordTeams: (teams) => Effect.sync(() => remote.store.recordTeams(teams)),
          upsertTeamKey: (stored) => Effect.sync(() => remote.store.upsertTeamKey(stored)),
          removeTeam: (teamId) => Effect.sync(() => remote.store.removeTeam(teamId)),
          resolveMachineKey: Effect.tryPromise({ try: () => remote.store.resolveMachineKey(), catch: broke }),
          resolveSigningKey: Effect.tryPromise({ try: () => remote.store.resolveSigningKey(), catch: broke }),
        },
        publish: Effect.sync(() => remote.publish()),
        requestHeartbeat: Effect.tryPromise({
          try: () => remote.requestHeartbeat(),
          catch: (error) => new TeamHeartbeatFailed({ message: describeError(error) }),
        }),
        appOrigin: Effect.sync(() => remote.appOrigin),
        isEnabled: Effect.sync(() => remote.isEnabled),
        machineName: Effect.sync(() => remote.snapshot().machineName),
        acquireAccess: (onEnd) =>
          Effect.sync(() => {
            const release = remote.access.acquire(() => edgeRuntime.runSync(onEnd));
            return Effect.sync(release);
          }),
        resolveTaskLive: (taskId) =>
          Effect.tryPromise({ try: () => shares.resolveLive(taskId, TEAM_SHARE_PRESET), catch: broke }),
        listHeld: (teamId) => Effect.sync(() => held?.listHeld(teamId) ?? []),
        now: Effect.sync(now),
        random: (bytes) => Effect.sync(() => random(bytes)),
      })
    );
    remote.subscribe(() => edgeRuntime.runSync(this.#handle.syncChannels));
    engine.subscribe(() => edgeRuntime.runSync(this.#handle.syncChannels));
    options.transcripts.subscribe((runId) => edgeRuntime.runSync(this.#handle.pushTranscript(runId)));
    held?.subscribeHeld(() => edgeRuntime.runSync(this.#handle.pushLists));
  }

  create(name: string) {
    return edgeRuntime.runPromise(this.#handle.create(name));
  }

  join(url: string) {
    return edgeRuntime.runPromise(this.#handle.join(url));
  }

  resolveJoinUrl(teamId: string) {
    return edgeRuntime.runPromise(this.#handle.resolveJoinUrl(teamId));
  }

  renewInvite(teamId: string) {
    return edgeRuntime.runPromise(this.#handle.renewInvite(teamId));
  }

  turnOffInvite(teamId: string) {
    return edgeRuntime.runPromise(this.#handle.turnOffInvite(teamId));
  }

  acceptRequest(teamId: string, userId: string) {
    return edgeRuntime.runPromise(this.#handle.acceptRequest(teamId, userId));
  }

  declineRequest(teamId: string, userId: string) {
    return edgeRuntime.runPromise(this.#handle.declineRequest(teamId, userId));
  }

  removeMember(teamId: string, userId: string) {
    return edgeRuntime.runPromise(this.#handle.removeMember(teamId, userId));
  }

  leave(teamId: string) {
    return edgeRuntime.runPromise(this.#handle.leave(teamId));
  }

  remove(teamId: string) {
    return edgeRuntime.runPromise(this.#handle.remove(teamId));
  }

  acceptsViewer() {
    return edgeRuntime.runSync(this.#handle.acceptsViewer);
  }

  openChannel(peer: ChannelPeer, userId: string) {
    return new ShareChannel<TeamSubject>(edgeRuntime.runSync(this.#handle.openChannel(peer, userId)));
  }

  closeChannel(channel: ShareChannel<TeamSubject>) {
    edgeRuntime.runSync(this.#handle.closeChannel(channel.handle));
  }
}
