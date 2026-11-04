import { Effect, Schema } from 'effect';
import { Chromium } from '../../kit/chromium/index.ts';
import { openWithProbe } from '../browser/probe.ts';
import { PROBE } from '../content-probe.ts';
import { CONTENT_WINDOW, SCROLL_STEP, WAIT_FOR_STATE } from './schema.ts';

export const openContentPage = Effect.fn('ContentPerf.openPage')(function* (base: string) {
  const chromium = yield* Chromium;
  const page = yield* chromium.launch(CONTENT_WINDOW);
  yield* openWithProbe(page, PROBE, `${base}/`);
  yield* page.evaluate(WAIT_FOR_STATE, Schema.Unknown);
  return page;
});

export function resolveStepExpression(step: string) {
  return step.startsWith(SCROLL_STEP)
    ? `window.__perf.scroll(${JSON.stringify(step.slice(SCROLL_STEP.length))}, 'up', 150, 160)`
    : `window.__perf.navigate(${JSON.stringify(step)}, 'body')`;
}
