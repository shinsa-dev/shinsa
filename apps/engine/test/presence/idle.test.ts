import { afterEach, describe, expect, test } from 'bun:test';
import { createState, HOUR_MS, MINUTE_MS } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { IdleWatch } from '../../src/presence/idle/service.ts';
import { parseHidIdleMs } from '../../src/presence/mac-idle/parse.ts';
import { MacIdle } from '../../src/presence/mac-idle/service.ts';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { CommandNotFound } from '../../src/shell/schema.ts';
import { Shell } from '../../src/shell/service.ts';
import { createFakeEngineCore, openServices } from '../runtime/harness.ts';

const open: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

const NOW = 10 * HOUR_MS + 5 * MINUTE_MS;

async function openWatch(idle: (number | null)[], fails = false) {
  const fake = createFakeEngineCore(createState(), () =>
    fails ? new EngineStopped({ message: 'log full' }) : []
  );
  const readings = [...idle];
  const mac = Layer.succeed(MacIdle, MacIdle.of({ idleMs: Effect.sync(() => readings.shift() ?? null) }));
  const harness = await openServices(IdleWatch.layer.pipe(Layer.provide(mac)), fake.core, { now: NOW });
  open.push(harness);
  const watch = harness.service(IdleWatch);
  return { fake, harness, poll: () => harness.run(watch.poll) };
}

describe('reading how long your Mac has been idle', () => {
  test('reads the HID idle time from ioreg in milliseconds', () => {
    expect(parseHidIdleMs('| |   "HIDIdleTime" = 258519893000\n')).toBe(258_519);
    expect(parseHidIdleMs('nothing here')).toBeNull();
  });

  const readIdle = (run: Shell['Service']['run']) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* MacIdle).idleMs;
      }).pipe(
        Effect.provide(
          MacIdle.layer.pipe(
            Layer.provide(Layer.succeed(Shell, Shell.of({ run, stopTree: () => Effect.void })))
          )
        )
      )
    );

  test('is nothing when ioreg fails or is missing, as off a Mac', async () => {
    const result = { ok: false, code: 1, stdout: '', stderr: '', timedOut: false };
    expect(await readIdle(() => Effect.succeed(result))).toBeNull();
    expect(
      await readIdle(() => Effect.fail(new CommandNotFound({ command: 'ioreg', message: 'not found' })))
    ).toBeNull();
    expect(
      await readIdle(() => Effect.succeed({ ...result, ok: true, stdout: '"HIDIdleTime" = 2000000' }))
    ).toBe(2);
  });
});

describe('the engine watching your Mac', () => {
  test('records your Mac in use once an hour, and a span you were away when you come back', async () => {
    const { fake, harness, poll } = await openWatch([0, 0, 0, 0]);
    await poll();
    await harness.adjust(MINUTE_MS);
    await poll();
    expect(fake.sent.map((sent) => sent.command)).toEqual([
      { type: 'idle.record', inputAt: NOW, away: null },
    ]);
    await harness.adjust(30 * MINUTE_MS);
    await poll();
    expect(fake.sent.at(-1)?.command).toEqual({
      type: 'idle.record',
      inputAt: NOW + 31 * MINUTE_MS,
      away: { from: NOW + 11 * MINUTE_MS, to: NOW + 31 * MINUTE_MS },
    });
    await harness.adjust(HOUR_MS);
    await poll();
    expect(fake.sent).toHaveLength(3);
  });

  test('sends nothing when it cannot read the idle time, and only logs a refusal', async () => {
    const quiet = await openWatch([null]);
    await quiet.poll();
    expect(quiet.fake.sent).toEqual([]);
    const refused = await openWatch([0, 0], true);
    await refused.poll();
    await refused.poll();
    expect(refused.fake.sent).toHaveLength(2);
  });

  test('starts once and stops', async () => {
    const { harness } = await openWatch([]);
    const watch = harness.service(IdleWatch);
    await harness.run(watch.start);
    await harness.run(watch.start);
    await harness.run(watch.stop);
    await harness.run(watch.stop);
  });
});
