import { Effect } from 'effect';

export const awaitAbort = (signal: AbortSignal) =>
  Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void);
    const onAbort = () => resume(Effect.void);
    signal.addEventListener('abort', onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', onAbort));
  });

export const resolveCancel = (signal: AbortSignal | undefined) => (signal ? awaitAbort(signal) : undefined);
