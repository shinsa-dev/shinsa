import type { EffectCancellation, ShinsaEffect } from '@shinsa/core';
import { Schema } from 'effect';
import type { StoredPayloadMessages } from '../shared/schema.ts';

export const EffectRow = Schema.Struct({
  id: Schema.Int,
  key: Schema.String,
  lane: Schema.String,
  kind: Schema.String,
  payload: Schema.String,
  attempts: Schema.Int,
});
export type EffectRow = typeof EffectRow.Type;

export const EffectRowStatus = Schema.Literals(['pending', 'running', 'done', 'failed', 'cancelled']);
export type EffectRowStatus = typeof EffectRowStatus.Type;

export const OpenEffectRow = Schema.Struct({
  id: Schema.Int,
  key: Schema.String,
  status: Schema.Literals(['pending', 'running']),
});
export type OpenEffectRow = typeof OpenEffectRow.Type;

export const EffectStatus = Schema.Struct({
  key: Schema.String,
  kind: Schema.String,
  status: EffectRowStatus,
  attempts: Schema.Int,
});
export type EffectStatus = typeof EffectStatus.Type;

export const StatusRow = Schema.Struct({ status: EffectRowStatus });

export const NextAvailableRow = Schema.Struct({ at: Schema.NullOr(Schema.Number) });

export const LastEffectIdRow = Schema.Struct({ id: Schema.Int });

export const ChangedRow = Schema.Struct({ id: Schema.Int });

const NewEffectRow = Schema.Struct({
  key: Schema.String,
  lane: Schema.String,
  kind: Schema.String,
  payload: Schema.String,
  status: Schema.Literal('pending'),
  availableAt: Schema.Number,
  createdAt: Schema.Number,
});

export const NewEffectRows = Schema.NonEmptyArray(NewEffectRow);

export const CancelRequest = Schema.Struct({
  ids: Schema.Array(Schema.Int),
  at: Schema.Number,
  reason: Schema.String,
});

export interface StoredEffect {
  id: number;
  key: string;
  lane: string;
  effect: ShinsaEffect;
  attempts: number;
}

export interface CancelledEffect {
  id: number;
  key: string;
  running: boolean;
}

export interface EffectEnqueue {
  effects: ShinsaEffect[];
  cancellations: EffectCancellation[];
  lastSeq: number | null;
  at: number;
}

export interface Reconciled {
  requeued: number;
  cancelled: CancelledEffect[];
  failed: number;
}

export const SETTLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const SEED_STRIDE = 1000;

export const REQUEUED = 'Requeued after the previous server process ended.';

export const ENDED_WITH_PROCESS = 'Cancelled because the server process ended before the effect finished.';

export const UNKNOWN_KIND = 'Shinsa does not know this kind of effect; another version wrote it.';

export const EFFECT_PAYLOAD_MESSAGES: StoredPayloadMessages = {
  notJson: 'The stored effect is not valid JSON',
  mismatched: 'The stored effect does not match its kind.',
};
