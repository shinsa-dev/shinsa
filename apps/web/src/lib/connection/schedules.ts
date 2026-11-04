import { toast } from '@shinsa/ui/components/sonner';
import { Effect } from 'effect';
import { copyText, describeFailure } from '@/lib/connection/commands.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { StepFailed } from '@/lib/runtime/schema.ts';

const readWebhook = Effect.fn('Schedules.readWebhook')(function* (scheduleId: string) {
  const engine = yield* EngineClient;
  return yield* engine.secrets.webhook({ params: { scheduleId } });
});

export function requestWebhook(scheduleId: string) {
  return runApp(readWebhook(scheduleId));
}

export function requestWebhookCopy(read: () => Promise<{ url: string }>) {
  return runApp(
    Effect.tryPromise({
      try: read,
      catch: (error) => new StepFailed({ message: describeFailure(error) }),
    }).pipe(
      Effect.andThen(({ url }) => Effect.promise(() => copyText(url))),
      Effect.catchTag('StepFailed', (failed) => Effect.sync(() => toast.error(failed.message))),
      Effect.asVoid
    )
  );
}
