import { Duration, Schema } from 'effect';

export class ShotTargetMissing extends Schema.TaggedError<
  ShotTargetMissing,
  { readonly brand: unique symbol }
>()('ShotTargetMissing', { message: Schema.String }) {}

export class ShotEncodeFailed extends Schema.TaggedError<
  ShotEncodeFailed,
  { readonly brand: unique symbol }
>()('ShotEncodeFailed', { message: Schema.String }) {}

export const ScreencastFrame = Schema.Struct({
  data: Schema.String,
  sessionId: Schema.Number,
  metadata: Schema.Struct({ timestamp: Schema.Number }),
});

export const Identified = Schema.Struct({ identifier: Schema.String });

export const Captured = Schema.Struct({ data: Schema.String });

export const PagePoint = Schema.NullOr(Schema.Struct({ x: Schema.Number, y: Schema.Number }));

export const BROWSER_WINDOW = { width: 1280, height: 800 };

export const FIXTURE_SETTLE = Duration.millis(150);

export const APP_SETTLE = Duration.millis(2500);

export const KEY_GAP = Duration.millis(120);

export const SHOT_SCALE = 2;
