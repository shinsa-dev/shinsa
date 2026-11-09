import { Schema } from 'effect';
import type { Key } from '../../kit/chromium/index.ts';

export interface Step {
  label: string;
  open?: { target: string; done: string };
  pushes?: string;
  target?: string;
  key?: Key;
  done: string;
}

export const Measured = Schema.Struct({
  clickToPaint: Schema.Number,
  commits: Schema.Number,
  rendered: Schema.Number,
  longTasks: Schema.Number,
  longTaskTotal: Schema.Number,
});

export const MeasuredOrNull = Schema.NullOr(Measured);

export const Settled = Schema.Struct({ settledAt: Schema.Number, maxGap: Schema.Number });

export const Paints = Schema.Struct({
  timeOrigin: Schema.Number,
  firstContentfulPaint: Schema.NullOr(Schema.Number),
  largestContentfulPaint: Schema.NullOr(Schema.Number),
});

export interface Launch {
  navigationStart: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  homeReady: number;
}

export class ShellStepTimedOut extends Schema.TaggedError<
  ShellStepTimedOut,
  { readonly brand: unique symbol }
>()('ShellStepTimedOut', { message: Schema.String }) {}

export class AppNeverOpened extends Schema.TaggedError<AppNeverOpened, { readonly brand: unique symbol }>()(
  'AppNeverOpened',
  { message: Schema.String }
) {}

export class UserDataUnremovable extends Schema.TaggedError<
  UserDataUnremovable,
  { readonly brand: unique symbol }
>()('UserDataUnremovable', { path: Schema.String, message: Schema.String }) {}

export const HOME = `document.querySelector('header [aria-label="Home"]') || __shell.byPrefix('header button', '^Shinsa') || __shell.byText('nav [data-highlight-item]', 'New task')`;

export const HOME_DONE = `location.pathname === '/' && !!document.querySelector('main textarea')`;

export const TASK_ROW = String.raw`__shell.byPrefix('main button', '[A-Z]+-\\d+ ·')`;

export const TAB_READY: Readonly<Record<string, string>> = {
  Code: `!!document.querySelector('.cm-content')`,
};

export const TERMINAL_DONE = `location.pathname === '/terminal' && __shell.terminals > 0 && __shell.terminalsWaiting === 0 && [...document.querySelectorAll('.xterm')].some((terminal) => terminal.offsetParent && terminal.querySelector('.xterm-screen canvas'))`;

export const TERMINAL_SHOWN = `[...document.querySelectorAll('.xterm')].some((terminal) => terminal.offsetParent && terminal.querySelector('.xterm-screen canvas'))`;

export const PROJECT_PICKER = `[...document.querySelectorAll('main button[aria-haspopup=menu]')].find((button) => button.offsetParent)`;

export const OPEN_SETTLE_MS = 400;

export const STARTUP_PORT = 9520;

export const STARTUP_TIMEOUT = '30 seconds';

export const HOME_READY = `!!document.querySelector('main textarea')`;

export const PAINTS = `new Promise((done) => {
  let largest = null;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) largest = entry.renderTime || entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  setTimeout(() => {
    const first = performance.getEntriesByName('first-contentful-paint')[0];
    done({ timeOrigin: performance.timeOrigin, firstContentfulPaint: first ? first.startTime : null, largestContentfulPaint: largest });
  }, 50);
})`;

export const LAUNCH_KEYS = [
  'navigationStart',
  'firstContentfulPaint',
  'largestContentfulPaint',
  'homeReady',
] as const;
