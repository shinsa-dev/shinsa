import { describe, expect, test } from 'bun:test';
import { Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { MachineId } from './domain.ts';
import { runTest } from './harness.ts';
import { Machines } from './machines.ts';

const STUDIO = MachineId.make('studio-mac');
const LAPTOP = MachineId.make('laptop');

describe('a service hides its store behind typed methods', () => {
  test('a paired machine is found, selected and listed in pairing order, stamped by the clock', async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const machines = yield* Machines;
        yield* TestClock.setTime(1_000);
        yield* machines.pair({ id: STUDIO, name: 'Studio' });
        yield* TestClock.setTime(2_000);
        yield* machines.pair({ id: LAPTOP, name: 'Laptop' });
        return {
          found: yield* machines.find(STUDIO),
          selected: yield* machines.select(LAPTOP),
          listed: yield* machines.list,
        };
      })
    );
    expect(result.found).toMatchObject({ id: STUDIO, status: 'online', pairedAt: 1_000 });
    expect(Option.getOrThrow(result.selected).pairedAt).toBe(2_000);
    expect(result.listed.map((machine) => machine.id)).toEqual([STUDIO, LAPTOP]);
  });

  test('find fails with MachineNotFound where select returns none, and a second pairing is refused', async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const machines = yield* Machines;
        yield* machines.pair({ id: STUDIO, name: 'Studio' });
        return {
          missing: yield* Effect.flip(machines.find(LAPTOP)),
          selected: yield* machines.select(LAPTOP),
          twice: yield* Effect.flip(machines.pair({ id: STUDIO, name: 'Studio' })),
        };
      })
    );
    expect(result.missing).toMatchObject({ _tag: 'MachineNotFound', machineId: LAPTOP });
    expect(Option.isNone(result.selected)).toBe(true);
    expect(result.twice).toMatchObject({ _tag: 'MachineAlreadyPaired', machineId: STUDIO });
  });
});

test('one call reaches a service with use, and its failure is asserted by tag', async () => {
  const error = await runTest(Effect.flip(Machines.use((machines) => machines.find(LAPTOP))));
  expect(error).toMatchObject({ _tag: 'MachineNotFound', machineId: LAPTOP });
});
