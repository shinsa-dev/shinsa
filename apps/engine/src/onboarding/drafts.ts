import { Effect, Option, Schema } from 'effect';
import { JsonFile } from '../files/service.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { SetupDraft } from './schema.ts';

const decodeDraft = Schema.decodeUnknownEffect(SetupDraft);

export function readSetupDraft(path: string): SetupDraft | null {
  return edgeRuntime.runSync(
    JsonFile.use((file) => file.read(path, Schema.Unknown)).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed<SetupDraft | null>(null),
          onSome: (value) =>
            decodeDraft(value).pipe(
              Effect.catchTag('SchemaError', () =>
                Effect.logWarning(
                  '[Onboarding] The saved setup is not one Shinsa wrote; starting again'
                ).pipe(Effect.annotateLogs({ path }), Effect.as(null))
              )
            ),
        })
      ),
      Effect.catchTag('JsonFileUnreadable', (unreadable) =>
        Effect.logWarning('[Onboarding] The saved setup could not be read; starting again').pipe(
          Effect.annotateLogs({ path, error: unreadable.reason }),
          Effect.as(null)
        )
      )
    )
  );
}

export function writeSetupDraft(path: string, draft: SetupDraft) {
  edgeRuntime.runSync(JsonFile.use((file) => file.write(path, draft)));
}
