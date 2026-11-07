import type { ReplayFailure, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { UnreadableEvent } from '../events/schema.ts';

export type LogProblem = (ReplayFailure | UnreadableEvent) & { kind: 'unreadable' | 'unappliable' };

export const SNAPSHOT_FORMAT = 1;

export const STATE_SOURCE_FILE = /^(?:[^./][^/]*\/)*[^./][^/]*\.ts$/;

export interface StateSnapshot {
  seq: number;
  version: string;
  payload: string;
  problems: LogProblem[];
}

export const SnapshotRow = Schema.Struct({
  seq: Schema.Int,
  version: Schema.String,
  anchor: Schema.String,
  checksum: Schema.String,
  problems: Schema.String,
  payload: Schema.String,
});
export type SnapshotRow = typeof SnapshotRow.Type;

export const StoredState = Schema.fromJsonString(
  Schema.StructWithRest(Schema.Struct({ seq: Schema.Int }), [Schema.Record(Schema.String, Schema.Unknown)])
);

export const StoredProblems = Schema.fromJsonString(Schema.Array(Schema.Unknown));

type SnapshotRefusal = 'version' | 'checksum' | 'anchor' | 'unreadable';

export type SnapshotRead =
  | { ok: true; seq: number; state: ShinsaState; problems: LogProblem[] }
  | { ok: false; seq: number; reason: SnapshotRefusal };
