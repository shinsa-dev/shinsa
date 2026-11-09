import { Effect, Schedule, type Scope } from 'effect';
import type { Style } from './style.ts';

export type Progress = Effect.Effect<void, never, Scope.Scope>;

interface ProgressStream {
  write: (text: string) => unknown;
}

export const SPINNER_FRAMES = Schedule.spaced('80 millis');

const CLEAR_LINE = '\r\u001b[2K';

export const NO_PROGRESS: Progress = Effect.void;

export function createSpinner(stream: ProgressStream, style: Style, text: string): Progress {
  const frames = style.symbols?.spinner;
  if (!frames) return NO_PROGRESS;
  let frame = 0;
  const draw = Effect.sync(() => {
    stream.write(`${CLEAR_LINE}${style.accent(frames[frame % frames.length] ?? '')} ${style.dim(text)}`);
    frame += 1;
  });
  return Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sync(() => stream.write(CLEAR_LINE)));
    yield* draw;
    yield* Effect.forkScoped(Effect.schedule(draw, SPINNER_FRAMES));
  });
}
