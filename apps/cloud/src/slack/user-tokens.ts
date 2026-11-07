import type { InstanceId } from '@shinsa/core';
import { Cause, Effect, Redacted, Schema } from 'effect';
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
          : Effect.logWarning('[Cloud] Slack did not revoke a user token').pipe(
              Effect.annotateLogs({ error, code: error.code })
            )
      )
    );
});

const revokeSealedUserToken = Effect.fn('revokeSealedUserToken')(function* (sealed: string) {
  const crypto = yield* CloudCrypto;
  yield* revokeUserToken(yield* crypto.openToken(sealed));
});

export const replaceUserToken = Effect.fn('replaceUserToken')(function* (
  sealed: string | null,
  token: Redacted.Redacted<string>
) {
  const crypto = yield* CloudCrypto;
  if (sealed === null) return;
  const previous = yield* crypto.openToken(sealed);
  if (Redacted.value(previous) !== Redacted.value(token)) yield* revokeUserToken(previous);
});

export const revokeMachineUserTokens = Effect.fn('revokeMachineUserTokens')(function* (
  instanceId: InstanceId
) {
  const store = yield* SlackStore;
  for (const link of yield* store.listMachineLinks(instanceId)) {
    if (link.sealedUserToken === null) continue;
    yield* revokeSealedUserToken(link.sealedUserToken).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning('[Cloud] A Slack user token could not be revoked').pipe(
          Effect.annotateLogs({ cause: Cause.pretty(cause), teamId: link.workspaceId })
        )
      )
    );
  }
});
