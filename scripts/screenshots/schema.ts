import { Duration, Schedule, Schema } from 'effect';

export class StepFailed extends Schema.TaggedError<StepFailed, { readonly brand: unique symbol }>()(
  'StepFailed',
  {
    message: Schema.String,
  }
) {}

export class WaitTimedOut extends Schema.TaggedError<WaitTimedOut, { readonly brand: unique symbol }>()(
  'WaitTimedOut',
  { message: Schema.String }
) {}

export class WindowNotFound extends Schema.TaggedError<WindowNotFound, { readonly brand: unique symbol }>()(
  'WindowNotFound',
  { message: Schema.String }
) {}

export const Theme = Schema.Literals(['light', 'dark']);
export type Theme = typeof Theme.Type;

export const AppWindow = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  bounds: Schema.Struct({ X: Schema.Number, Y: Schema.Number, Width: Schema.Number, Height: Schema.Number }),
});

export const AppWindowsText = Schema.fromJsonString(Schema.Array(AppWindow));

export const Health = Schema.Struct({ ok: Schema.Boolean, dataDir: Schema.String });

export const WINDOW = { width: 1000, height: 700 };

export const THEMES: readonly Theme[] = ['light', 'dark'];

export const CLEARED_ENV = ['SHINSA_HOME', 'SHINSA_URL', 'SHINSA_PORT', 'SHINSA_WEB_DIR', 'SHINSA_DATA_DIR'];

export const WAIT_TIMEOUT = Duration.seconds(60);

export const QUIT_TIMEOUT = Duration.seconds(8);

export const READY_POLL = Schedule.spaced(Duration.millis(200));

export const SETTLED_CHECKS = 5;

export const SETTLE_PAUSE = Duration.millis(1200);

export const FOCUS_PAUSE = Duration.millis(400);
