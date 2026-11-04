import { describe, expect, it, spyOn } from 'bun:test';
import { Effect } from 'effect';
import { WorkerLogger } from '../../src/worker/logger.ts';

describe('WorkerLogger', () => {
  it('writes errors to console.error and everything else to console.log, with the annotations', async () => {
    const errors = spyOn(console, 'error').mockImplementation(() => undefined);
    const lines = spyOn(console, 'log').mockImplementation(() => undefined);
    await Effect.runPromise(
      Effect.all([
        Effect.annotateLogs(Effect.logError('R2 failed'), { key: 'a' }),
        Effect.logWarning('Slow feed', 2),
      ]).pipe(Effect.provide(WorkerLogger))
    );
    expect(errors.mock.calls).toEqual([['R2 failed', { key: 'a' }]]);
    expect(lines.mock.calls).toEqual([['Slow feed', { detail: [2] }]]);
    errors.mockRestore();
    lines.mockRestore();
  });
});
