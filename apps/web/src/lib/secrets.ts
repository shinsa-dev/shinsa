import type { Gate } from '@shinsa/core';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestSecretAnswer } from '@/lib/connection/secrets.ts';

export const SECRET_NOTE = 'It goes to Shinsa’s secret store. The agent and the chat never see it.';

function requestSecret(gateId: string, body: { value: string } | { decline: true }, done: string) {
  return requestWithToast(() => requestSecretAnswer(gateId, body), done);
}

export function saveSecret(gateId: string, value: string) {
  return requestSecret(gateId, { value }, 'Saved. The agent carries on.');
}

export function declineSecret(gateId: string) {
  return requestSecret(gateId, { decline: true }, 'Declined. The agent carries on.');
}

export function resolveSecretLabel(gate: Gate) {
  return gate.secret?.label ?? 'secret';
}
