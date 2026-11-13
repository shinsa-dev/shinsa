import type { PowerEvent } from '@shinsa/core';
import { Effect, Layer, Queue, Stream } from 'effect';
import { powerMonitor } from 'electron';
import { PowerMonitor } from '../power-monitor/service.ts';

export const PowerMonitorLive = Layer.effect(
  PowerMonitor,
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<PowerEvent>();
    const emit = (event: PowerEvent) => () => {
      Queue.offerUnsafe(events, event);
    };
    powerMonitor.on('lock-screen', emit('lock'));
    powerMonitor.on('unlock-screen', emit('unlock'));
    powerMonitor.on('suspend', emit('suspend'));
    powerMonitor.on('resume', emit('resume'));
    return PowerMonitor.of({
      idleMs: Effect.sync(() => powerMonitor.getSystemIdleTime() * 1000),
      events: Stream.fromQueue(events),
    });
  })
);
