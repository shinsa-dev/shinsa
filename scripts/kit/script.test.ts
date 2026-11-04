import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { Effect, Exit, Fiber } from 'effect';
import { reportFailure } from './script.ts';
import { createTempDirectory } from './temp.ts';

const errors: unknown[] = [];

afterEach(() => {
  errors.length = 0;
});

function captureErrors() {
  return spyOn(console, 'error').mockImplementation((line: unknown) => {
    errors.push(line);
  });
}

describe('reportFailure', () => {
  test('prints a failure’s message alone and keeps the failure', async () => {
    const spy = captureErrors();
    const exit = await Effect.runPromiseExit(reportFailure(Effect.fail({ message: 'Name the app.' })));
    spy.mockRestore();
    expect(Exit.isFailure(exit)).toBe(true);
    expect(errors).toEqual(['Name the app.']);
  });

  test('prints a defect in full and nothing for an interruption or a success', async () => {
    const spy = captureErrors();
    await Effect.runPromiseExit(reportFailure(Effect.die(new Error('broken invariant'))));
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(reportFailure(Effect.never));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
      })
    );
    await Effect.runPromise(reportFailure(Effect.succeed('done')));
    spy.mockRestore();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('broken invariant');
  });
});

describe('createTempDirectory', () => {
  test('makes a folder that lives as long as its scope', async () => {
    const inside = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* createTempDirectory('shinsa-kit-');
          return { directory, existed: existsSync(directory) };
        })
      )
    );
    expect(inside.directory).toContain('shinsa-kit-');
    expect(inside.existed).toBe(true);
    expect(existsSync(inside.directory)).toBe(false);
  });
});
