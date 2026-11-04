import { Effect } from 'effect';
import type { CdpPage } from '../../kit/chromium/index.ts';

export const openWithProbe = Effect.fn('PerfPage.openWithProbe')(function* (
  page: CdpPage,
  probe: string,
  url: string
) {
  yield* page.send('Page.enable');
  yield* page.send('Page.addScriptToEvaluateOnNewDocument', { source: probe });
  yield* page.send('Page.navigate', { url });
});
