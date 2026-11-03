import { MachineSession, RemoteApi } from '@shinsa/core/remote/api';
import { BodyInvalid, BodyTooLarge, ContentTypeInvalid } from '@shinsa/core/remote/errors';
import { type Duration, Effect, Layer, Option, Predicate, Context } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { HttpApiClient, HttpApiMiddleware } from 'effect/http-api';
import {
  MachineToken,
  type MachineCalls,
  OFFLINE_CALL_TIMEOUT,
  type PairingCalls,
  REMOTE_CALL_TIMEOUT,
  RemoteOrigin,
  RemoteUnreachable,
  type SlackRelayCalls,
  type TeamCalls,
  type Token,
  TRANSPORT_TAGS,
  type TransportFailure,
} from './schema.ts';

export class RemoteClient extends Context.Service<
  RemoteClient,
  {
    readonly origin: string;
    readonly pairing: PairingCalls;
    readonly machine: MachineCalls;
    readonly teams: TeamCalls;
    readonly slack: SlackRelayCalls;
  }
>()('shinsa/engine/remote/client/RemoteClient') {
  static readonly layer = Layer.effect(
    RemoteClient,
    Effect.gen(function* () {
      const origin = yield* RemoteOrigin;
      const httpClient = yield* HttpClient.HttpClient;
      const session = HttpApiMiddleware.layerClient(
        MachineSession,
        Effect.fnUntraced(function* ({ request, next }) {
          const token = yield* Effect.serviceOption(MachineToken);
          return yield* next(
            Option.isSome(token) ? HttpClientRequest.bearerToken(request, token.value) : request
          );
        })
      );
      const options = { httpClient, baseUrl: origin };
      const pairing = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'pairing' });
      const machine = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'machine' }).pipe(
        Effect.provide(session)
      );
      const teams = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'machineTeams' }).pipe(
        Effect.provide(session)
      );
      const slack = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'slackRelay' }).pipe(
        Effect.provide(session)
      );

      const resolveStatus = (error: TransportFailure) => {
        if (error._tag === 'HttpClientError') return error.response?.status ?? null;
        if (error._tag === 'SchemaError') return null;
        return { BodyInvalid, BodyTooLarge, ContentTypeInvalid }[error._tag].status;
      };

      const reach = (endpoint: string, error: TransportFailure) => {
        const status = resolveStatus(error);
        return new RemoteUnreachable({
          endpoint,
          status,
          retryable: status === null || status === 429 || status >= 500,
          message:
            status === null
              ? `app.shinsa.dev could not be reached for ${endpoint}.`
              : `app.shinsa.dev answered ${endpoint} with status ${status}.`,
        });
      };

      const call = <A, E>(
        endpoint: string,
        request: Effect.Effect<A, E>,
        timeout: Duration.Input = REMOTE_CALL_TIMEOUT
      ) =>
        request.pipe(
          Effect.catchIf(
            (error): error is Extract<E, TransportFailure> =>
              Predicate.hasProperty(error, '_tag') && TRANSPORT_TAGS.has(String(error._tag)),
            (error) => Effect.fail(reach(endpoint, error))
          ),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(
                new RemoteUnreachable({
                  endpoint,
                  status: null,
                  retryable: true,
                  message: `app.shinsa.dev did not answer ${endpoint} in time.`,
                })
              ),
          })
        );

      const asMachine =
        (token: Token) =>
        <A, E>(effect: Effect.Effect<A, E>) =>
          Effect.provideService(effect, MachineToken, token);

      return RemoteClient.of({
        origin,
        pairing: {
          start: (payload) => call('pairing.start', pairing.start({ payload })),
          poll: (payload) => call('pairing.poll', pairing.poll({ payload })),
        },
        machine: {
          heartbeat: (token, payload) =>
            call('machine.heartbeat', machine.heartbeat({ payload }).pipe(asMachine(token))),
          offline: (token) =>
            call(
              'machine.offline',
              machine.offline({}).pipe(asMachine(token), Effect.asVoid),
              OFFLINE_CALL_TIMEOUT
            ),
          remove: (token) => call('machine.remove', machine.remove({}).pipe(asMachine(token), Effect.asVoid)),
          createInvite: (token) =>
            call('machine.inviteCreate', machine.inviteCreate({}).pipe(asMachine(token))),
          removeInvite: (token) =>
            call('machine.inviteRemove', machine.inviteRemove({}).pipe(asMachine(token), Effect.asVoid)),
          findRequester: (token, userId) =>
            call(
              'machine.requesterFind',
              machine.requesterFind({ payload: { userId } }).pipe(asMachine(token))
            ),
          addMember: (token, userId) =>
            call('machine.memberAdd', machine.memberAdd({ payload: { userId } }).pipe(asMachine(token))),
          removeMember: (token, userId) =>
            call(
              'machine.memberRemove',
              machine.memberRemove({ payload: { userId } }).pipe(asMachine(token), Effect.asVoid)
            ),
          createHandoff: (token) =>
            call('machine.handoffCreate', machine.handoffCreate({}).pipe(asMachine(token))),
          removeHandoff: (token, invite) =>
            call(
              'machine.handoffRemove',
              machine.handoffRemove({ payload: { token: invite } }).pipe(asMachine(token), Effect.asVoid)
            ),
          addGuest: (token, userId) =>
            call('machine.guestAdd', machine.guestAdd({ payload: { userId } }).pipe(asMachine(token))),
          removeGuest: (token, userId) =>
            call(
              'machine.guestRemove',
              machine.guestRemove({ payload: { userId } }).pipe(asMachine(token), Effect.asVoid)
            ),
        },
        teams: {
          create: (token, name) =>
            call('machineTeams.create', teams.create({ payload: { name } }).pipe(asMachine(token))),
          join: (token, invite) =>
            call('machineTeams.join', teams.join({ payload: { invite } }).pipe(asMachine(token))),
          invite: (token, teamId) =>
            call('machineTeams.invite', teams.invite({ params: { teamId } }).pipe(asMachine(token))),
          removeInvite: (token, teamId) =>
            call(
              'machineTeams.inviteRemove',
              teams.inviteRemove({ params: { teamId } }).pipe(asMachine(token), Effect.asVoid)
            ),
          addMember: (token, teamId, userId) =>
            call(
              'machineTeams.memberAdd',
              teams.memberAdd({ params: { teamId }, payload: { userId } }).pipe(asMachine(token))
            ),
          removeMember: (token, teamId, userId) =>
            call(
              'machineTeams.memberRemove',
              teams
                .memberRemove({ params: { teamId }, payload: { userId } })
                .pipe(asMachine(token), Effect.asVoid)
            ),
          declineRequest: (token, teamId, userId) =>
            call(
              'machineTeams.requestDecline',
              teams
                .requestDecline({ params: { teamId }, payload: { userId } })
                .pipe(asMachine(token), Effect.asVoid)
            ),
          leave: (token, teamId) =>
            call(
              'machineTeams.leave',
              teams.leave({ params: { teamId } }).pipe(asMachine(token), Effect.asVoid)
            ),
          remove: (token, teamId) =>
            call(
              'machineTeams.remove',
              teams.remove({ params: { teamId } }).pipe(asMachine(token), Effect.asVoid)
            ),
          connect: (token, teamId, instanceId) =>
            call(
              'machineTeams.connect',
              teams.connect({ params: { teamId }, payload: { instanceId } }).pipe(asMachine(token))
            ),
          permissions: (token, teamId, request) =>
            call(
              'machineTeams.permissions',
              teams.permissions({ params: { teamId }, payload: request }).pipe(asMachine(token))
            ),
        },
        slack: {
          links: (token) => call('slackRelay.links', slack.links({}).pipe(asMachine(token))),
          unlink: (token) =>
            call('slackRelay.unlink', slack.unlink({}).pipe(asMachine(token), Effect.asVoid)),
          post: (token, payload) => call('slackRelay.post', slack.post({ payload }).pipe(asMachine(token))),
          session: (token, payload) =>
            call('slackRelay.session', slack.session({ payload }).pipe(asMachine(token))),
          react: (token, payload) =>
            call('slackRelay.react', slack.react({ payload }).pipe(asMachine(token))),
        },
      });
    })
  );
}
