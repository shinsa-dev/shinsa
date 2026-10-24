import type { Gate } from '@shinsa/core';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';

export const SECRET_NOTE = 'It goes to Shinsa’s secret store. The agent and the chat never see it.';

function requestSecret(gateId: string, body: unknown, done: string) {
  return requestWithToast(() => requestJson(`/api/secrets/${encodeURIComponent(gateId)}`, body), done);
}

export function saveSecret(gateId: string, value: string) {
  return requestSecret(gateId, { value }, 'Saved. The agent carries on.');
}

export function declineSecret(gateId: string) {
  return requestSecret(gateId, { decline: true }, 'Declined. The agent carries on without it.');
}

export function resolveSecretLabel(gate: Gate) {
  return gate.secret?.label ?? 'secret';
}
