import { Effect } from 'effect';
import { runApp } from './app.ts';
import type { AppServices } from './schema.ts';

export function createSharedRun(effect: Effect.Effect<void, never, AppServices>) {
  let running: { done: Promise<void> | null } | null = null;
  return {
    run() {
      if (running?.done) return running.done;
      const run: { done: Promise<void> | null } = { done: null };
      running = run;
      const settle = Effect.sync(() => {
        if (running === run) running = null;
      });
      run.done = runApp(Effect.ensuring(effect, settle));
      return run.done;
    },
    reset() {
      running = null;
    },
  };
}
