import { describe, expect, test } from 'bun:test';
import { Effect, Exit, Fiber, Scope } from 'effect';
import {
  acquireAgentSession,
  type AgentSession,
  type AgentSessionResult,
} from '../../../src/agents/providers/index.ts';

function createSession(cancel?: Effect.Effect<void>) {
  const ended = Promise.withResolvers<AgentSessionResult>();
  const calls: string[] = [];
  const session: AgentSession = {
    done: Effect.promise(() => ended.promise),
    steer: () => Effect.succeed(true),
    cancel:
      cancel ??
      Effect.sync(() => {
        calls.push('cancel');
        ended.resolve({ outcome: 'cancelled', summary: null });
      }),
  };
  return { session, calls, finish: (result: AgentSessionResult) => ended.resolve(result) };
}

describe('an agent session as a scoped resource', () => {
  test('its result is what the session ended with, and a finished session is not cancelled', async () => {
    const fake = createSession();
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scoped = yield* acquireAgentSession(Effect.succeed(fake.session));
          expect(scoped.session).toBe(fake.session);
          fake.finish({ outcome: 'completed', summary: 'Done.' });
          return yield* scoped.done;
        })
      )
    );
    expect(result).toEqual({ outcome: 'completed', summary: 'Done.' });
    expect(fake.calls).toEqual([]);
  });

  test('closing its scope cancels a running session, waits for it to end and still gives its result', async () => {
    const fake = createSession();
    const scope = Effect.runSync(Scope.make());
    const scoped = await Effect.runPromise(
      acquireAgentSession(Effect.succeed(fake.session)).pipe(Scope.provide(scope))
    );
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(fake.calls).toEqual(['cancel']);
    expect(await Effect.runPromise(scoped.done)).toEqual({ outcome: 'cancelled', summary: null });
  });

  test('interrupting the fiber that holds it cancels the session', async () => {
    const fake = createSession();
    const fiber = Effect.runFork(
      Effect.scoped(
        Effect.flatMap(acquireAgentSession(Effect.succeed(fake.session)), (scoped) => scoped.done)
      )
    );
    await Promise.resolve();
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(fake.calls).toEqual(['cancel']);
  });

  test('a session whose cancel dies still lets its scope close', async () => {
    const fake = createSession(Effect.die(new Error('gone')));
    const scope = Effect.runSync(Scope.make());
    await Effect.runPromise(acquireAgentSession(Effect.succeed(fake.session)).pipe(Scope.provide(scope)));
    await Effect.runPromise(Scope.close(scope, Exit.void));
    fake.finish({ outcome: 'completed', summary: null });
  });
});
