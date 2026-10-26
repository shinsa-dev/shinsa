import type { Display } from './layout.ts';
import { createSpinner, NO_PROGRESS, type Progress } from './spinner.ts';
import { resolveStyle, type Style } from './style.ts';

export { selectClosest } from './closest.ts';
export {
  type Display,
  describeCommandTerm,
  describeFields,
  describeHeading,
  describeList,
  describeParagraph,
  describeTable,
  describeUsageLines,
  PLAIN_DISPLAY,
  resolveTermWidth,
  splitUsage,
} from './layout.ts';
export { NO_PROGRESS, type Progress } from './spinner.ts';
export { describeInline, describeMark, PLAIN_STYLE, paintTone, type Style, type Tone } from './style.ts';
export { shortenHome, splitHint, stripStyles } from './text.ts';

export interface Terminal {
  display: Display;
  errorStyle: Style;
  home: string | undefined;
  startProgress: (text: string) => Progress;
}

interface TerminalStream {
  isTTY?: boolean;
  columns?: number;
  write: (text: string) => unknown;
}

type Env = Record<string, string | undefined>;

function resolveWidth(env: Env, stream: TerminalStream) {
  const columns = Number(env.COLUMNS);
  if (Number.isInteger(columns) && columns > 0) return columns;
  return stream.isTTY && stream.columns ? stream.columns : null;
}

export function resolveTerminal(env: Env, out: TerminalStream, error: TerminalStream): Terminal {
  const style = resolveStyle(env, Boolean(out.isTTY));
  const errorStyle = resolveStyle(env, Boolean(error.isTTY));
  return {
    display: { style, width: resolveWidth(env, out) },
    errorStyle,
    home: env.HOME,
    startProgress: (text) => (error.isTTY ? createSpinner(error, errorStyle, text) : NO_PROGRESS),
  };
}
