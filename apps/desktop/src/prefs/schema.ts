import { AppUpdateChannel } from '@shinsa/core/engine-api/schema';
import { Effect, Option, Schema } from 'effect';
import { SourceSetting } from '../source/schema.ts';
import { SavedBounds } from '../window/schema.ts';

export const PREFS_FILE = 'prefs.json';

export const StoredPrefs = Schema.Struct({
  windowBounds: Schema.optionalKey(
    SavedBounds.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))
  ),
  updateChannel: Schema.optionalKey(
    AppUpdateChannel.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))
  ),
  engineSource: Schema.optionalKey(
    SourceSetting.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))
  ),
  keptVersion: Schema.optionalKey(
    Schema.NullOr(Schema.String).pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))
  ),
});

export type StoredPrefs = typeof StoredPrefs.Type;

export const PrefsFile = Schema.fromJsonString(StoredPrefs, { space: 2 });
