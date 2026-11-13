import { Layer } from 'effect';
import { ScheduleClock } from './clock/service.ts';
import { Schedules } from './service.ts';
import type { ScheduleToolsInput } from './tools/schema.ts';
import { ScheduleTools } from './tools/service.ts';
import { WebhookReceiver } from './webhook/service.ts';

export function SchedulesLayer(urls: ScheduleToolsInput) {
  return Schedules.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(ScheduleClock.layer, WebhookReceiver.layer, ScheduleTools.layer(urls)))
  );
}
