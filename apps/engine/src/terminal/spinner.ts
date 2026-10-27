import type { Style } from './style.ts';

export interface Progress {
  stop: () => void;
}

interface ProgressStream {
  write: (text: string) => unknown;
}

const FRAME_MS = 80;

const CLEAR_LINE = '\r\u001b[2K';

export const NO_PROGRESS: Progress = { stop: () => undefined };

export function createSpinner(stream: ProgressStream, style: Style, text: string): Progress {
  const frames = style.symbols?.spinner;
  if (!frames) return NO_PROGRESS;
  let frame = 0;
  const draw = () => {
    stream.write(`${CLEAR_LINE}${style.accent(frames[frame % frames.length] ?? '')} ${style.dim(text)}`);
    frame += 1;
  };
  draw();
  const timer = setInterval(draw, FRAME_MS);
  return {
    stop: () => {
      clearInterval(timer);
      stream.write(CLEAR_LINE);
    },
  };
}
