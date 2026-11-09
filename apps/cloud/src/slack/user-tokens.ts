import type { InstanceId } from '@shinsa/core';
import { Cause, Effect, Option, Redacted, Schema } from 'effect';
import { CloudCrypto } from '../crypto/service.ts';
import { SlackApi } from '../integrations/slack/service.ts';
import { SlackStore } from '../store/slack/service.ts';
import { SETTLED_REVOKE_CODES } from './schema.ts';

const revokeUserToken = Effect.fn('revokeUserToken')(function* (token: Redacted.Redacted<string>) {
  const slack = yield* SlackApi;
  yield* slack
    .call('auth.revoke', { token, body: { empty: true } }, Schema.Unknown)
    .pipe(
      Effect.catchTag('SlackCallFailed', (error) =>
        SETTLED_REVOKE_CODES.has(error.code)
          ? Effect.void
          : Effect.logWarning('[Cloud] A Slack user token could not be revoked').pipe(
              Effect.annotateLogs({ error, code: error.code })
            )
      )
    );
});

export const selectUserToken = Effect.fn('selectUserToken')(function* (sealed: string) {
  const crypto = yield* CloudCrypto;
  return yield* crypto.openToken(sealed).pipe(
    Effect.map(Option.some),
    Effect.catchDefect((defect) =>
      Effect.as(
        Effect.logWarning('[Cloud] A stored Slack user token does not open').pipe(
          Effect.annotateLogs({ cause: Cause.pretty(Cause.die(defect)) })
        ),
        Option.none<Redacted.Redacted<string>>()
      )
    )
  );
});

const revokeSealedUserToken = Effect.fn('revokeSealedUserToken')(function* (sealed: string) {
  const token = yield* selectUserToken(sealed);
  if (Option.isSome(token)) yield* revokeUserToken(token.value);
});

export const replaceUserToken = Effect.fn('replaceUserToken')(function* (
  sealed: string | null,
  token: Redacted.Redacted<string>
) {
  if (sealed === null) return;
  const previous = yield* selectUserToken(sealed);
  if (Option.isSome(previous) && Redacted.value(previous.value) !== Redacted.value(token))
    yield* revokeUserToken(previous.value);
});

export const revokeMachineUserTokens = Effect.fn('revokeMachineUserTokens')(function* (
  instanceId: InstanceId
) {
  const store = yield* SlackStore;
  for (const link of yield* store.listMachineLinks(instanceId)) {
    if (link.sealedUserToken === null) continue;
    yield* revokeSealedUserToken(link.sealedUserToken);
  }
});
