import { describe, expect, spyOn, test } from 'bun:test';
import { Context, Effect } from 'effect';
import { deferWork, WorkerContext, WorkerLogger } from '../../src/http/worker.ts';

describe('the Worker’s plumbing', () => {
  test('writes errors to console.error, warnings to console.warn and everything else to console.log, with the annotations', async () => {
    const errors = spyOn(console, 'error').mockImplementation(() => undefined);
    const warnings = spyOn(console, 'warn').mockImplementation(() => undefined);
    const infos = spyOn(console, 'log').mockImplementation(() => undefined);
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.logError('[Cloud] Request failed').pipe(Effect.annotateLogs({ code: 'server_error' }));
        yield* Effect.logWarning('[Cloud] Machine offline').pipe(Effect.annotateLogs({ surface: 'webhook' }));
        yield* Effect.logInfo('[Cloud] Paired', 'Studio');
      }).pipe(Effect.provide(WorkerLogger))
    );
    expect(errors).toHaveBeenCalledWith('[Cloud] Request failed', { code: 'server_error' });
    expect(warnings).toHaveBeenCalledWith('[Cloud] Machine offline', { surface: 'webhook' });
    expect(infos).toHaveBeenCalledWith('[Cloud] Paired', { detail: ['Studio'] });
    expect(infos).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    warnings.mockRestore();
    infos.mockRestore();
  });

  test('hands work that outlives the response to waitUntil, run with the request’s services', async () => {
    const pending: Promise<unknown>[] = [];
    const ran: string[] = [];
    await Effect.runPromise(
      deferWork(Effect.sync(() => ran.push('after'))).pipe(
        Effect.provideContext(Context.make(WorkerContext, { waitUntil: (work) => pending.push(work) }))
      )
    );
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(ran).toEqual(['after']);
  });
});
