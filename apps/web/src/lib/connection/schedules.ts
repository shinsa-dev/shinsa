import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';

const readWebhook = Effect.fn('Schedules.readWebhook')(function* (scheduleId: string) {
  const engine = yield* EngineClient;
  return yield* engine.secrets.webhook({ params: { scheduleId } });
});

export function requestWebhook(scheduleId: string) {
  return runApp(readWebhook(scheduleId));
}
