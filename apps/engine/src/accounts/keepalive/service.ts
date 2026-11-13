import { Clock, Context, Effect, Layer, Option, Ref, Schema } from 'effect';
import { isLoginText } from '../../agents/providers/claude/classify.ts';
import type { CommandResult } from '../../shell/schema.ts';
import { AccountCommands } from '../command/service.ts';
import { StoredLogins } from '../credentials/service.ts';
import { resolveAccountEnv } from '../paths.ts';
import type { StoredAccount } from '../schema.ts';
import {
  KEEPALIVE_ARGS,
  KEEPALIVE_AUTH_STATUSES,
  KEEPALIVE_IDLE,
  KEEPALIVE_SIGNED_OUT_DETAIL,
  KEEPALIVE_TIMEOUT,
  KeepaliveAnswerText,
  type KeepaliveOutcome,
  type KeepaliveRequest,
  KeepaliveTimings,
} from './schema.ts';

export class LoginKeepalive extends Context.Service<
  LoginKeepalive,
  {
    keep(request: KeepaliveRequest): Effect.Effect<KeepaliveOutcome>;
    clear(accountId: string): Effect.Effect<void>;
  }
>()('shinsa/engine/accounts/keepalive/LoginKeepalive') {
  static readonly layer = Layer.effect(
    LoginKeepalive,
    Effect.gen(function* () {
      const logins = yield* StoredLogins;
      const commands = yield* AccountCommands;
      const timings = yield* KeepaliveTimings;
      const attempts = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
      const running = yield* Ref.make<ReadonlySet<string>>(new Set());
      const decodeAnswer = Schema.decodeUnknownOption(KeepaliveAnswerText);

      const isAuthRefusal = (result: CommandResult) => {
        const answer = Option.getOrNull(decodeAnswer(result.stdout));
        if (answer === null) return isLoginText(`${result.stdout}\n${result.stderr}`);
        if (KEEPALIVE_AUTH_STATUSES.has(answer.api_error_status ?? 0)) return true;
        return answer.is_error === true && isLoginText(answer.result ?? '');
      };

      const clear = (accountId: string) =>
        Ref.update(attempts, (all) => {
          const rest = new Map(all);
          rest.delete(accountId);
          return rest;
        });

      const readExpiry = (account: StoredAccount) =>
        Effect.map(logins.read(account.configDir), (login) => (login ? login.expiresAt : undefined));

      const isDue = Effect.fn('LoginKeepalive.isDue')(function* (request: KeepaliveRequest, now: number) {
        const attemptedAt = (yield* Ref.get(attempts)).get(request.account.id);
        if (!request.force && attemptedAt !== undefined && now < attemptedAt + timings.backoffMs)
          return false;
        const expiresAt = yield* readExpiry(request.account);
        if (expiresAt === undefined) return false;
        if (expiresAt !== null && expiresAt <= now + timings.marginMs) return true;
        return request.readExpired;
      });

      const runTurn = Effect.fn('LoginKeepalive.runTurn')(function* (request: KeepaliveRequest, cwd: string) {
        const { account, claude } = request;
        const result = yield* commands.run([claude, ...KEEPALIVE_ARGS], cwd, {
          env: resolveAccountEnv(cwd),
          timeout: KEEPALIVE_TIMEOUT,
        });
        if (isAuthRefusal(result)) {
          const signedOut: KeepaliveOutcome = { kind: 'signed_out', detail: KEEPALIVE_SIGNED_OUT_DETAIL };
          return signedOut;
        }
        const expiresAt = yield* readExpiry(account);
        const alive = expiresAt === null || (expiresAt ?? 0) > (yield* Clock.currentTimeMillis);
        const outcome: KeepaliveOutcome = { kind: alive && !result.timedOut ? 'refreshed' : 'failed' };
        return outcome;
      });

      const keep = Effect.fn('LoginKeepalive.keep')(function* (request: KeepaliveRequest) {
        const { account } = request;
        const { configDir } = account;
        if (account.origin !== 'login' || !configDir) return KEEPALIVE_IDLE;
        const now = yield* Clock.currentTimeMillis;
        if (!(yield* isDue(request, now))) return KEEPALIVE_IDLE;
        const taken = yield* Ref.modify(running, (ids) =>
          ids.has(account.id) ? [false, ids] : [true, new Set(ids).add(account.id)]
        );
        if (!taken) return KEEPALIVE_IDLE;
        yield* Ref.update(attempts, (all) => new Map(all).set(account.id, now));
        const outcome = yield* runTurn(request, configDir).pipe(
          Effect.ensuring(Ref.update(running, (ids) => new Set([...ids].filter((id) => id !== account.id))))
        );
        yield* Effect.logInfo('[Accounts] Kept an idle login alive').pipe(
          Effect.annotateLogs({ accountId: account.id, outcome: outcome.kind })
        );
        return outcome;
      });

      return LoginKeepalive.of({ keep, clear });
    })
  );
}
