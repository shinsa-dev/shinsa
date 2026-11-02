import { Schema } from 'effect';

const ReceiptStatus = Schema.Literals(['accepted', 'rejected']);

export const CommandReceipt = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  target: Schema.String,
  fingerprint: Schema.String,
  status: ReceiptStatus,
  code: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  firstSeq: Schema.Int,
  lastSeq: Schema.Int,
  at: Schema.Number,
});
export type CommandReceipt = typeof CommandReceipt.Type;

export type ReceiptInput = Pick<CommandReceipt, 'id' | 'type' | 'target' | 'fingerprint'>;
