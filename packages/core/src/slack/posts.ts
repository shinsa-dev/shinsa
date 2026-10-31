import type { GateType } from '../domain/types.ts';

export type SlackPost =
  | { kind: 'gate'; gateId: string }
  | { kind: 'result' }
  | { kind: 'forwarded' }
  | { kind: 'declined'; reason: string };

export const SLACK_POSTED_GATES: ReadonlySet<GateType> = new Set([
  'question',
  'secret',
  'plan',
  'review',
  'proposal',
]);
