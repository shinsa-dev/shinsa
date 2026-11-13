import { Schema } from 'effect';

export const StoredListText = Schema.fromJsonString(Schema.Array(Schema.Unknown));

export const StoredDisclosuresText = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Number, entries: Schema.Array(Schema.Unknown) })
);

export const DisclosureEntry = Schema.Tuple([Schema.String, Schema.Boolean]);
