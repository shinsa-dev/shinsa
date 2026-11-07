import { DomainError, OWNER_ONLY_CODE, OWNER_ONLY_MESSAGE } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import {
  type GitHubTokenAnswer,
  RequestFailed,
  RouteNotFound,
  ROUTE_NOT_FOUND_MESSAGE,
} from '@shinsa/core/engine-api/schema';
import { Effect, Option, Predicate } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { EngineConfig } from '../../../config/service.ts';
import { verifyGitHubToken } from '../../../github/identity/resolve.ts';
import {
  GITHUB_TOKEN_INVALID,
  GITHUB_TOKEN_MACHINE,
  GITHUB_TOKEN_NO_OWNER,
  MAX_GITHUB_TOKEN,
} from '../../../github/identity/schema.ts';
import { GitHubCli } from '../../../github/service.ts';
import { Remote } from '../../../remote/machine/service.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { Schedules } from '../../../schedules/service.ts';
import { SecretStore } from '../../../secrets/store/service.ts';
import { resolveRequestFailure } from '../../failures.ts';
import { RequestSource } from '../../schema.ts';
import { GATE_CLOSED, MAX_SECRET, NO_SECRET_GATE, NO_WEBHOOK, SECRET_INVALID } from './schema.ts';

export const SecretsHandlers = HttpApiBuilder.group(
  EngineApi,
  'secrets',
  Effect.fn('SecretsHandlers')(function* (handlers) {
    const engine = yield* EngineCore;
    const schedules = Option.getOrUndefined(yield* Effect.serviceOption(Schedules));
    const store = Option.getOrUndefined(yield* Effect.serviceOption(SecretStore));
    const remote = Option.getOrNull(yield* Effect.serviceOption(Remote));
    const cli = Option.getOrNull(yield* Effect.serviceOption(GitHubCli));
    const config = yield* EngineConfig;

    const findSchedules =
      schedules && store
        ? Effect.succeed({ schedules, secrets: store })
        : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    const readSecret = (value: unknown) =>
      Predicate.isString(value) && value.length > 0 && value.length <= MAX_SECRET
        ? Effect.succeed(value)
        : Effect.fail(new RequestFailed(SECRET_INVALID));

    const findWebhook = Effect.fn('SecretsHandlers.findWebhook')(function* (scheduleId: string) {
      const context = yield* findSchedules;
      const schedule = (yield* engine.state).schedules[scheduleId];
      if (schedule?.trigger.kind !== 'webhook') return yield* new RequestFailed(NO_WEBHOOK);
      return { context, trigger: schedule.trigger };
    });

    const serializeWebhook = Effect.fn('SecretsHandlers.serializeWebhook')(function* (scheduleId: string) {
      const { context, trigger } = yield* findWebhook(scheduleId);
      return {
        url: yield* Effect.mapError(context.schedules.findHookUrl(scheduleId), resolveRequestFailure),
        signature: trigger.signature,
        hasSecret: Boolean((yield* context.secrets.selectHook(scheduleId))?.secret),
        replayKey: trigger.replayKey,
      };
    });

    const findSecretGate = Effect.fn('SecretsHandlers.findSecretGate')(function* (gateId: string) {
      const context = yield* findSchedules;
      const gate = (yield* engine.state).gates[gateId];
      if (!gate?.secret) return yield* new RequestFailed(NO_SECRET_GATE);
      if (gate.status !== 'open') return yield* new RequestFailed(GATE_CLOSED);
      return { gate, secrets: context.secrets };
    });

    const resolveTokenOwner = Effect.fn('SecretsHandlers.resolveTokenOwner')(function* () {
      const { via, userId } = yield* RequestSource;
      if (!remote) return yield* new DomainError(GITHUB_TOKEN_NO_OWNER);
      if (via === 'local' || !userId || (yield* remote.isOwner(userId))) {
        const owner = yield* remote.resolveActor(null);
        if (!owner) return yield* new DomainError(GITHUB_TOKEN_NO_OWNER);
        return { login: owner.login, machine: true };
      }
      const member = yield* remote.resolveActor(userId);
      if (!member) return yield* new DomainError({ code: OWNER_ONLY_CODE, message: OWNER_ONLY_MESSAGE });
      return { login: member.login, machine: false };
    });

    const describeToken = Effect.fn('SecretsHandlers.describeToken')(function* (
      secrets: SecretStore['Service'],
      owner: { login: string; machine: boolean }
    ) {
      const stored = owner.machine ? null : yield* secrets.selectGitHubToken(owner.login);
      const answer: GitHubTokenAnswer = {
        login: owner.login,
        saved: stored !== null,
        savedAt: stored?.savedAt ?? null,
        machineLogin: owner.machine,
      };
      return answer;
    });

    const readToken = (value: unknown) =>
      Predicate.isString(value) && value.trim().length > 0 && value.trim().length <= MAX_GITHUB_TOKEN
        ? Effect.succeed(value.trim())
        : Effect.fail(new DomainError(GITHUB_TOKEN_INVALID));

    const writeToken = Effect.fn('SecretsHandlers.writeToken')(function* (
      secrets: SecretStore['Service'],
      github: GitHubCli['Service'],
      value: unknown
    ) {
      const owner = yield* resolveTokenOwner();
      if (owner.machine) return yield* new DomainError(GITHUB_TOKEN_MACHINE);
      if (value === null) yield* secrets.removeGitHubToken(owner.login);
      else {
        const token = yield* readToken(value);
        yield* secrets.writeGitHubToken(yield* verifyGitHubToken(github, token, owner.login, config.dataDir));
      }
      return yield* describeToken(secrets, owner);
    });

    const notFound = Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    return handlers
      .handle('githubToken', () =>
        store
          ? resolveTokenOwner().pipe(
              Effect.flatMap((owner) => describeToken(store, owner)),
              Effect.mapError(resolveRequestFailure)
            )
          : notFound
      )
      .handle('writeGitHubToken', ({ payload }) =>
        store && cli
          ? writeToken(store, cli, payload.token).pipe(Effect.mapError(resolveRequestFailure))
          : notFound
      )
      .handle('webhook', ({ params }) => serializeWebhook(params.scheduleId))
      .handle(
        'writeWebhookSecret',
        Effect.fn('SecretsHandlers.writeWebhookSecret')(function* ({ params, payload }) {
          const { context } = yield* findWebhook(params.scheduleId);
          const secret = payload.secret === null ? null : yield* readSecret(payload.secret);
          yield* context.secrets.writeHookSecret(params.scheduleId, secret);
          return yield* serializeWebhook(params.scheduleId);
        })
      )
      .handle(
        'answer',
        Effect.fn('SecretsHandlers.answer')(function* ({ params, payload }) {
          const { gateId } = params;
          const { gate, secrets } = yield* findSecretGate(gateId);
          if (payload.decline === true) {
            yield* Effect.mapError(
              engine.dispatch(
                { type: 'gate.answer', gateId, decision: 'reject', response: null },
                { id: `secret:${gateId}:declined` }
              ),
              resolveRequestFailure
            );
            return { ok: true as const };
          }
          const value = yield* readSecret(payload.value);
          const ref = yield* secrets.writeRef(gateId, gate.taskId, value);
          yield* Effect.mapError(
            engine.dispatch(
              { type: 'gate.answer', gateId, decision: 'reply', response: ref },
              { id: `secret:${gateId}:saved` }
            ),
            resolveRequestFailure
          ).pipe(Effect.tapError(() => Effect.ignore(secrets.removeRef(ref, gate.taskId))));
          return { ok: true as const };
        })
      );
  })
);
