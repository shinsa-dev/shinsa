import { Context, Effect, Schema } from 'effect';
import { createLenientList } from '../files/lenient-list.ts';

export const RandomBytes = Context.Reference<(bytes: number) => Uint8Array<ArrayBuffer>>(
  'shinsa/engine/remote/RandomBytes',
  { defaultValue: () => (bytes: number) => crypto.getRandomValues(new Uint8Array(bytes)) }
);

export const NORMAL_CLOSE = 1000;

export const POLICY_VIOLATION = 1008;

export const VIEW_FILE_MISSING = 'The view file is missing.';

export const RemoteFileFields = Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)).pipe(
  Schema.catchDecoding(() => Effect.succeedSome(null))
);

const HeldTeamListFields = Schema.Struct({
  teamId: Schema.String,
  instanceId: Schema.String,
  keyDigest: Schema.String,
  tasks: Schema.Array(Schema.Unknown),
  initiatives: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  updatedAt: Schema.Number,
  snapshot: Schema.optionalKey(Schema.Unknown),
});

export const TeamSnapshotsFile = Schema.Struct({
  lists: Schema.optionalKey(createLenientList(HeldTeamListFields)),
}).pipe(Schema.catchDecoding(() => Effect.succeedSome({})));

const TeamViewEntryFields = Schema.Struct({
  teamId: Schema.String,
  instanceId: Schema.String,
  taskId: Schema.String,
  keyDigest: Schema.String,
  updatedAt: Schema.Number,
  size: Schema.Number,
});

export const TeamViewsIndexFile = Schema.Struct({
  entries: Schema.optionalKey(createLenientList(TeamViewEntryFields)),
}).pipe(Schema.catchDecoding(() => Effect.succeedSome({})));

export const TeamViewFile = Schema.Struct({
  messages: Schema.optionalKey(createLenientList(Schema.Unknown)),
}).pipe(Schema.catchDecoding(() => Effect.succeedSome({})));
