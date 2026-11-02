import type { EffectCancellation, ShinsaEffect, ShinsaEvent, ShinsaEventInput } from '@shinsa/core';
import type { CancelledEffect } from '../outbox/schema.ts';
import type { ReceiptInput } from '../receipts/schema.ts';

export interface CommandCommit {
  events: ShinsaEventInput[];
  effects: ShinsaEffect[];
  cancellations: EffectCancellation[];
  fromSeq: number;
  at: number;
  receipt: ReceiptInput | null;
}

export interface CommittedCommand {
  events: ShinsaEvent[];
  cancelled: CancelledEffect[];
}
