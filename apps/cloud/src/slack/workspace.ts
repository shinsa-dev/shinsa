import { createSlackForwardSignature, SLACK_FORWARD_HEADERS } from '@shinsa/core';
import { Clock, Effect, Option, Redacted } from 'effect';
import { CloudCrypto } from '../crypto/service.ts';
import { Tunnels } from '../integrations/tunnels/service.ts';
import type { Machine } from '../store/machines/schema.ts';
import type { SlackWorkspace } from '../store/slack/schema.ts';
import { SlackStore } from '../store/slack/service.ts';

export const selectWorkspaceToken = Effect.fn('selectWorkspaceToken')(function* (teamId: string) {
  const store = yield* SlackStore;
  const crypto = yield* CloudCrypto;
  const workspace = yield* store.selectWorkspace(teamId);
  if (Option.isNone(workspace))
    return Option.none<{ workspace: SlackWorkspace; token: Redacted.Redacted<string> }>();
  return Option.some({
    workspace: workspace.value,
    token: yield* crypto.openToken(workspace.value.sealedBotToken),
  });
});

export const requestSignedMachine = Effect.fn('requestSignedMachine')(function* (
  machine: Machine,
  path: string,
  payload: unknown
) {
  const tunnels = yield* Tunnels;
  const body = JSON.stringify(payload);
  const timestamp = yield* Clock.currentTimeMillis;
  const signature = yield* Effect.promise(() =>
    createSlackForwardSignature(Redacted.value(machine.connectKey), timestamp, body)
  );
  return yield* tunnels.request(machine.id, path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SLACK_FORWARD_HEADERS.signature]: signature,
      [SLACK_FORWARD_HEADERS.timestamp]: String(timestamp),
    },
    body,
  });
});
