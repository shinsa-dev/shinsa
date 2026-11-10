import type { DomainError, SlackChannel } from '@shinsa/core';
import { Duration, Effect, Layer } from 'effect';
import type { EngineCore } from '../../src/runtime/engine/service.ts';
import { ScheduleClockTimings } from '../../src/schedules/clock/schema.ts';
import { Schedules, SchedulesLayer, type ScheduleToolCall } from '../../src/schedules/index.ts';
import { ScheduleTimeZone, SlackChannelLookup } from '../../src/schedules/schema.ts';
import { WebhookDeliveryId } from '../../src/schedules/webhook/schema.ts';
import { SecretStore } from '../../src/secrets/index.ts';
import { openServices } from '../runtime/harness.ts';

export interface SchedulesHarnessOptions {
  baseUrl?: string;
  hookUrl?: (scheduleId: string, token: string) => string | null;
  timeZone?: string;
  newId?: () => string;
  timings?: { minDelayMs: number; maxDelayMs: number };
  now?: number;
  slackChannels?: Effect.Effect<readonly SlackChannel[], DomainError>;
}

export function createClockTimings(timings: { minDelayMs: number; maxDelayMs: number }) {
  return Layer.succeed(ScheduleClockTimings, {
    minDelay: Duration.millis(timings.minDelayMs),
    maxDelay: Duration.millis(timings.maxDelayMs),
  });
}

export async function openSchedules(
  engine: EngineCore['Service'],
  secrets: SecretStore['Service'],
  options: SchedulesHarnessOptions = {}
) {
  const { hookUrl, timeZone, newId, timings, slackChannels } = options;
  const layer = SchedulesLayer({
    baseUrl: Effect.succeed(options.baseUrl ?? 'http://127.0.0.1:5180'),
    hookUrl: (scheduleId, token) => Effect.sync(() => hookUrl?.(scheduleId, token) ?? null),
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(SecretStore, secrets),
        timeZone ? Layer.succeed(ScheduleTimeZone, timeZone) : Layer.empty,
        newId ? Layer.succeed(WebhookDeliveryId, Effect.sync(newId)) : Layer.empty,
        timings ? createClockTimings(timings) : Layer.empty,
        slackChannels ? Layer.succeed(SlackChannelLookup, slackChannels) : Layer.empty
      )
    )
  );
  const harness = await openServices(
    layer,
    engine,
    options.now === undefined ? { liveClock: true } : { now: options.now }
  );
  const schedules = harness.service(Schedules);
  const tool = (name: string, input: Record<string, unknown>, call: ScheduleToolCall) => {
    const reply = schedules.handleTool(name, input, call);
    return reply ? harness.run(reply) : null;
  };
  return {
    ...harness,
    schedules,
    start: () => harness.run(schedules.start),
    stop: () => harness.run(schedules.stop),
    fireDue: () => harness.run(schedules.fireDue),
    upsertHookUrl: (scheduleId: string) => harness.run(schedules.upsertHookUrl(scheduleId)),
    handleWebhook: (request: Request, url: URL) => harness.run(schedules.handleWebhook(request, url)),
    tool,
  };
}

export type SchedulesHarness = Awaited<ReturnType<typeof openSchedules>>;
