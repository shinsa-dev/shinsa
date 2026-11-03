import {
  type InstanceId,
  type PairStartRequest,
  type PairStartResponse,
  type RemoteUserId,
  type SlackRelayPost,
  type SlackRelayReaction,
  type SlackRelaySession,
  type TeamId,
} from '@shinsa/core';
import { serializeRemoteFailure } from '@shinsa/core/remote/errors';
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Predicate, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { JsonLogger } from '../../log/service.ts';
import type { MachineKeyPair, PairingEnd } from '../pairing/schema.ts';
import { PairPollInterval } from '../pairing/schema.ts';
import { Pairings } from '../pairing/service.ts';
import { RELAY_FAILED_CODE, RemoteOrigin } from './schema.ts';
import { RemoteClient } from './service.ts';

export interface RemoteControlOptions {
  origin?: string;
  fetch?: typeof globalThis.fetch;
  pairPollMs?: number;
}

export interface PairingRun {
  readonly done: Promise<PairingEnd>;
  cancel(): void;
}

export function selectRemoteFailureTag(error: unknown) {
  return Predicate.hasProperty(error, '_tag') && Predicate.isString(error._tag) ? error._tag : null;
}

export function selectRemoteFailureCode(error: unknown) {
  if (!Predicate.hasProperty(error, '_tag') || !Predicate.isString(error._tag)) return null;
  if (error._tag === 'RemoteUnreachable') return RELAY_FAILED_CODE;
  const message =
    Predicate.hasProperty(error, 'message') && Predicate.isString(error.message) ? error.message : '';
  return serializeRemoteFailure({ _tag: error._tag, message }).body.error.code;
}

export function isRemoteRetryable(error: unknown) {
  return (
    Predicate.isTagged(error, 'RemoteUnreachable') &&
    Predicate.hasProperty(error, 'retryable') &&
    error.retryable === true
  );
}

export class RemoteControl {
  readonly origin: string;
  readonly layer: Layer.Layer<RemoteClient | Pairings>;
  readonly #runtime: ManagedRuntime.ManagedRuntime<RemoteClient | Pairings, never>;

  constructor(options: RemoteControlOptions = {}) {
    const settings = Layer.mergeAll(
      options.origin === undefined ? Layer.empty : Layer.succeed(RemoteOrigin, options.origin),
      options.fetch ? Layer.succeed(FetchHttpClient.Fetch, options.fetch) : Layer.empty,
      options.pairPollMs === undefined ? Layer.empty : Layer.succeed(PairPollInterval, options.pairPollMs)
    );
    const client = RemoteClient.layer.pipe(Layer.provide(FetchHttpClient.layer));
    this.layer = Pairings.layer.pipe(Layer.provideMerge(client), Layer.provide(settings));
    this.#runtime = ManagedRuntime.make(this.layer.pipe(Layer.provideMerge(JsonLogger)));
    this.origin = this.#runtime.runSync(RemoteClient.use((remote) => Effect.succeed(remote.origin)));
  }

  #run<A, E>(call: (client: RemoteClient['Service']) => Effect.Effect<A, E>) {
    return this.#runtime.runPromise(RemoteClient.use(call));
  }

  requestPairStart(request: PairStartRequest) {
    return this.#run((client) => client.pairing.start(request));
  }

  startPairing(start: PairStartResponse, machine: MachineKeyPair): PairingRun {
    const fiber = this.#runtime.runFork(Pairings.use((pairings) => pairings.await(start, machine)));
    const done = this.#runtime.runPromise(
      Fiber.await(fiber).pipe(
        Effect.map((exit): PairingEnd => (Exit.isSuccess(exit) ? exit.value : { status: 'cancelled' }))
      )
    );
    return { done, cancel: () => this.#runtime.runFork(Fiber.interrupt(fiber)) };
  }

  requestRemoval(machineToken: string) {
    return this.#run((client) => client.machine.remove(Redacted.make(machineToken)));
  }

  requestInvite(machineToken: string) {
    return this.#run((client) => client.machine.createInvite(Redacted.make(machineToken)));
  }

  requestInviteRemoval(machineToken: string) {
    return this.#run((client) => client.machine.removeInvite(Redacted.make(machineToken)));
  }

  requestRequester(machineToken: string, userId: string) {
    return this.#run((client) =>
      client.machine.findRequester(Redacted.make(machineToken), userId as RemoteUserId)
    );
  }

  requestMemberAddition(machineToken: string, userId: string) {
    return this.#run((client) =>
      client.machine.addMember(Redacted.make(machineToken), userId as RemoteUserId)
    );
  }

  requestMemberRemoval(machineToken: string, userId: string) {
    return this.#run((client) =>
      client.machine.removeMember(Redacted.make(machineToken), userId as RemoteUserId)
    );
  }

  requestHandoff(machineToken: string) {
    return this.#run((client) => client.machine.createHandoff(Redacted.make(machineToken)));
  }

  requestHandoffRemoval(machineToken: string, invite: string) {
    return this.#run((client) => client.machine.removeHandoff(Redacted.make(machineToken), invite));
  }

  requestGuestAddition(machineToken: string, userId: string) {
    return this.#run((client) =>
      client.machine.addGuest(Redacted.make(machineToken), userId as RemoteUserId)
    );
  }

  requestGuestRemoval(machineToken: string, userId: string) {
    return this.#run((client) =>
      client.machine.removeGuest(Redacted.make(machineToken), userId as RemoteUserId)
    );
  }

  requestTeamCreation(machineToken: string, name: string) {
    return this.#run((client) => client.teams.create(Redacted.make(machineToken), name));
  }

  requestTeamJoin(machineToken: string, invite: string) {
    return this.#run((client) => client.teams.join(Redacted.make(machineToken), invite));
  }

  requestTeamInvite(machineToken: string, teamId: string) {
    return this.#run((client) => client.teams.invite(Redacted.make(machineToken), teamId as TeamId));
  }

  requestTeamInviteRemoval(machineToken: string, teamId: string) {
    return this.#run((client) => client.teams.removeInvite(Redacted.make(machineToken), teamId as TeamId));
  }

  requestTeamMemberAddition(machineToken: string, teamId: string, userId: string) {
    return this.#run((client) =>
      client.teams.addMember(Redacted.make(machineToken), teamId as TeamId, userId as RemoteUserId)
    );
  }

  requestTeamMemberRemoval(machineToken: string, teamId: string, userId: string) {
    return this.#run((client) =>
      client.teams.removeMember(Redacted.make(machineToken), teamId as TeamId, userId as RemoteUserId)
    );
  }

  requestTeamDecline(machineToken: string, teamId: string, userId: string) {
    return this.#run((client) =>
      client.teams.declineRequest(Redacted.make(machineToken), teamId as TeamId, userId as RemoteUserId)
    );
  }

  requestTeamLeave(machineToken: string, teamId: string) {
    return this.#run((client) => client.teams.leave(Redacted.make(machineToken), teamId as TeamId));
  }

  requestTeamRemoval(machineToken: string, teamId: string) {
    return this.#run((client) => client.teams.remove(Redacted.make(machineToken), teamId as TeamId));
  }

  requestTeamConnect(machineToken: string, teamId: string, instanceId: string) {
    return this.#run((client) =>
      client.teams.connect(Redacted.make(machineToken), teamId as TeamId, instanceId as InstanceId)
    );
  }

  requestSlackLinks(machineToken: string) {
    return this.#run((client) => client.slack.links(Redacted.make(machineToken)));
  }

  requestSlackUnlink(machineToken: string) {
    return this.#run((client) => client.slack.unlink(Redacted.make(machineToken)));
  }

  requestSlackPost(machineToken: string, post: SlackRelayPost) {
    return this.#run((client) => client.slack.post(Redacted.make(machineToken), post));
  }

  requestSlackSession(machineToken: string, session: SlackRelaySession) {
    return this.#run((client) => client.slack.session(Redacted.make(machineToken), session));
  }

  requestSlackReaction(machineToken: string, reaction: SlackRelayReaction) {
    return this.#run((client) => client.slack.react(Redacted.make(machineToken), reaction));
  }
}
