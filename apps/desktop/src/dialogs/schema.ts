import { Schema } from 'effect';

export const MessageDialog = Schema.Struct({
  type: Schema.Literals(['info', 'warning', 'question']),
  message: Schema.String,
  detail: Schema.String,
  buttons: Schema.optionalKey(Schema.Array(Schema.String)),
  defaultId: Schema.optionalKey(Schema.Int),
  cancelId: Schema.optionalKey(Schema.Int),
});

export type MessageDialog = typeof MessageDialog.Type;
