import { type Effect, Schema } from 'effect';

export const ShellEvent = Schema.Union([
  Schema.TaggedStruct('OpenUrl', { url: Schema.String }),
  Schema.TaggedStruct('SecondInstance', { argv: Schema.Array(Schema.String) }),
  Schema.TaggedStruct('Activate', {}),
]);

export type ShellEvent = typeof ShellEvent.Type;

export const AboutPanel = Schema.Struct({
  applicationName: Schema.String,
  applicationVersion: Schema.String,
  credits: Schema.optionalKey(Schema.String),
});

export type AboutPanel = typeof AboutPanel.Type;

export interface ShellGuards {
  readonly beforeQuit: Effect.Effect<void>;
}
