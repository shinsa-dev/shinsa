import { launch } from './content-cdp.ts';
import { PROBE } from './content-probe.ts';

const BASE = Bun.argv[2] ?? 'http://localhost:5661';
const STEPS = (Bun.argv[3] ?? '/tasks/perf-long-chat?tab=overview,/tasks/perf-long-chat?tab=chat').split(',');

const MAIN_EVENTS = new Set([
  'FunctionCall',
  'EvaluateScript',
  'TimerFire',
  'RunMicrotasks',
  'UpdateLayoutTree',
  'Layout',
  'PrePaint',
  'Paint',
  'Layerize',
  'Commit',
  'MinorGC',
  'MajorGC',
  'ParseHTML',
  'HitTest',
  'IntersectionObserverController::computeIntersections',
  'ResizeObserverController::BroadcastObservations',
]);

interface TraceEvent {
  name: string;
  ph: string;
  dur?: number;
  ts: number;
  tid: number;
  pid: number;
}

const browser = await launch();
try {
  const { page } = browser;
  await page.send('Page.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await page.send('Page.navigate', { url: `${BASE}/` });
  await page.evaluate(
    'new Promise((resolve) => { const check = () => window.__perf?.lastState ? resolve(true) : setTimeout(check, 20); check(); })'
  );
  await page.evaluate('window.__perf.sleep(800)');
  for (const step of STEPS) {
    if (step.startsWith('scroll:')) continue;
    await page.evaluate(`window.__perf.navigate(${JSON.stringify(step)}, 'body')`);
    await page.evaluate('window.__perf.sleep(600)');
  }
  if (Bun.env.SHINSA_PERF_CSS) {
    await page.evaluate(
      `(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(Bun.env.SHINSA_PERF_CSS)}; document.head.append(style); })()`
    );
  }
  const events: TraceEvent[] = [];
  let complete = () => {};
  page.listen((raw: MessageEvent) => {
    const message = JSON.parse(String(raw.data)) as { method?: string; params?: { value?: TraceEvent[] } };
    if (message.method === 'Tracing.dataCollected') events.push(...(message.params?.value ?? []));
    if (message.method === 'Tracing.tracingComplete') complete();
  });
  for (const step of STEPS) {
    await page.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
      transferMode: 'ReportEvents',
    });
    const expression = step.startsWith('scroll:')
      ? `window.__perf.scroll(${JSON.stringify(step.slice(7))}, 'up', 150, 160)`
      : `window.__perf.navigate(${JSON.stringify(step)}, 'body')`;
    const result = await page.evaluate(expression);
    await page.evaluate('window.__perf.sleep(300)');
    events.length = 0;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    await page.send('Tracing.end');
    await done;
    const totals = new Map<string, number>();
    for (const event of events) {
      if (event.ph !== 'X' || !MAIN_EVENTS.has(event.name)) continue;
      totals.set(event.name, (totals.get(event.name) ?? 0) + (event.dur ?? 0) / 1000);
    }
    const summary = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, ms]) => `${name} ${ms.toFixed(1)}`)
      .join(', ');
    console.info(step, JSON.stringify(result), '\n   ', summary);
  }
} finally {
  browser.close();
}
