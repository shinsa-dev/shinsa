import { Schema } from 'effect';

export const StoredComments = Schema.fromJsonString(Schema.Array(Schema.Unknown));

export const StoredComment = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  line: Schema.Number,
  text: Schema.String,
});
