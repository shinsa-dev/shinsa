import { launch, type Page } from './content-cdp.ts';
import { PROBE } from './content-probe.ts';
import { summarize } from './content-stats.ts';

const BASE = Bun.argv[2] ?? 'http://localhost:5661';
const ROUNDS = Number(Bun.env.SHINSA_PERF_ROUNDS ?? 3);
const ONLY = Bun.env.SHINSA_PERF_ONLY?.split(',') ?? null;

interface Navigation {
  ms: number;
  found: boolean;
  long: { count: number; max: number; total: number };
}

const RUN = 'section[id^="run-"]';

const NONE: Record<string, number> = {};

function navigate(page: Page, path: string, ready = 'body') {
  return page.evaluate<Navigation>(
    `window.__perf.navigate(${JSON.stringify(path)}, ${JSON.stringify(ready)})`
  );
}

async function settle(page: Page) {
  await page.evaluate('window.__perf.sleep(600)');
}

function pickTask(page: Page) {
  if (Bun.env.SHINSA_PERF_TASK) return Promise.resolve(Bun.env.SHINSA_PERF_TASK);
  return page.evaluate<string>(`(() => {
    const state = JSON.parse(window.__perf.lastState).state;
    const counts = {};
    for (const run of Object.values(state.runs)) counts[run.taskId] = (counts[run.taskId] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  })()`);
}

function liveRun(page: Page, taskId: string) {
  return page.evaluate<string | null>(`(() => {
    const state = JSON.parse(window.__perf.lastState).state;
    const runs = Object.values(state.runs).filter((run) => run.taskId === ${JSON.stringify(taskId)});
    return (runs.find((run) => run.endedAt === null) ?? runs.at(-1))?.id ?? null;
  })()`);
}

async function typeText(page: Page, text: string) {
  for (const char of text) {
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: char,
      key: char,
      unmodifiedText: char,
    });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
    await Bun.sleep(45);
  }
}

const scenarios: Record<string, (page: Page, taskId: string) => Promise<Record<string, number>>> = {
  async openChat(page, taskId) {
    await navigate(page, '/');
    await settle(page);
    const open = await navigate(page, `/tasks/${taskId}?tab=chat`, RUN);
    const start = Date.now();
    await settle(page);
    const settled = await page.evaluate<{ count: number; max: number; total: number }>(
      `window.__perf.since(performance.now() - ${Date.now() - start + 600})`
    );
    return {
      paintMs: open.ms,
      paintLongMax: open.long.max,
      settleLongMax: settled.max,
      settleLongTotal: settled.total,
    };
  },
  async switchTabs(page, taskId) {
    await navigate(page, `/tasks/${taskId}?tab=chat`, RUN);
    await settle(page);
    for (const tab of ['overview', 'review', 'chat']) {
      await navigate(page, `/tasks/${taskId}?tab=${tab}`);
      await settle(page);
    }
    const overview = await navigate(page, `/tasks/${taskId}?tab=overview`);
    await settle(page);
    const review = await navigate(page, `/tasks/${taskId}?tab=review`);
    await settle(page);
    const chat = await navigate(page, `/tasks/${taskId}?tab=chat`, RUN);
    await settle(page);
    return { toOverviewMs: overview.ms, toReviewMs: review.ms, toChatMs: chat.ms };
  },
  async scrollChat(page, taskId) {
    await navigate(page, `/tasks/${taskId}?tab=chat`, RUN);
    await settle(page);
    const result = await page.evaluate<{
      p95: number;
      max: number;
      over16: number;
      vsyncP95: number;
      vsyncMax: number;
      dropped: number;
      long: { max: number; count: number };
    } | null>(`window.__perf.scroll(${JSON.stringify(RUN)}, 'up', 150, 160)`);
    if (!result) return NONE;
    return {
      vsyncP95: result.vsyncP95,
      vsyncMax: result.vsyncMax,
      framesDropped: result.dropped,
      frameP95: result.p95,
      frameMax: result.max,
      framesOver16: result.over16,
      longMax: result.long.max,
      longCount: result.long.count,
    };
  },
  async holdPlace(page, taskId) {
    await navigate(page, `/tasks/${taskId}?tab=chat`, RUN);
    await settle(page);
    const result = await page.evaluate<{ jumps: number; worst: number } | null>(
      `window.__perf.holdPlace(${JSON.stringify(RUN)}, 300, 160)`
    );
    if (!result) return NONE;
    return { placeJumps: result.jumps, placeWorstPx: Math.round(result.worst) };
  },
  async typeWhileStreaming(page, taskId) {
    await navigate(page, `/tasks/${taskId}?tab=chat`, RUN);
    await settle(page);
    const runId = await liveRun(page, taskId);
    const focused = await page.evaluate<boolean>(
      `(() => { const box = [...document.querySelectorAll('textarea')].find((each) => each.offsetParent !== null); if (!box) return false; box.focus(); return true; })()`
    );
    if (!focused || !runId) return NONE;
    const start = await page.evaluate<number>('performance.now()');
    await page.evaluate(`window.__perf.startStream(${JSON.stringify(runId)}, 20, 1)`);
    await typeText(page, 'the header should wrap on narrow windows ');
    await page.evaluate('window.__perf.stopStream()');
    const inputs = await page.evaluate<{ delay: number; paint: number }[]>(
      `window.__perf.inputsSince(${start})`
    );
    const long = await page.evaluate<{ max: number; count: number }>(`window.__perf.since(${start})`);
    const streamed = await page.evaluate<boolean>(`document.body.innerText.includes('Streaming update')`);
    return {
      streamed: streamed ? 1 : 0,
      inputPaintMax: Math.max(0, ...inputs.map((input) => input.paint)),
      inputOver16: inputs.filter((input) => input.paint > 16.7).length,
      longMax: long.max,
      longCount: long.count,
    };
  },
  async pushes(page, taskId) {
    await navigate(page, `/tasks/${taskId}?tab=chat`, RUN);
    await settle(page);
    const runId = await liveRun(page, taskId);
    const cost = await page.evaluate<{
      state: number;
      stateMax: number;
      transcript: number;
      transcriptMax: number;
    }>(`window.__perf.pushCost(${JSON.stringify(runId)}, 15)`);
    return {
      stateMs: cost.state,
      stateMaxMs: cost.stateMax,
      transcriptMs: cost.transcript,
      transcriptMaxMs: cost.transcriptMax,
    };
  },
  async lists(page) {
    await navigate(page, '/');
    await settle(page);
    const roadmap = await navigate(page, '/tasks', 'a[href^="/tasks/"]');
    await settle(page);
    const scroll = await page.evaluate<{ p95: number; max: number; long: { max: number } } | null>(
      `window.__perf.scroll('a[href^="/tasks/"]', 'down', 120, 120)`
    );
    const home = await navigate(page, '/', 'a[href^="/tasks/"]');
    await settle(page);
    return {
      roadmapPaintMs: roadmap.ms,
      roadmapLongMax: roadmap.long.max,
      roadmapScrollMax: scroll?.max ?? 0,
      roadmapScrollLongMax: scroll?.long.max ?? 0,
      homePaintMs: home.ms,
      homeLongMax: home.long.max,
    };
  },
};

async function runScenario(name: string) {
  const samples: Record<string, number>[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const browser = await launch();
    try {
      const { page } = browser;
      await page.send('Page.enable');
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
      await page.send('Page.navigate', { url: `${BASE}/` });
      await page.evaluate(
        `new Promise((resolve) => { const check = () => window.__perf?.lastState ? resolve(true) : setTimeout(check, 20); check(); })`
      );
      await settle(page);
      const taskId = await pickTask(page);
      samples.push(
        await (scenarios[name] as (page: Page, taskId: string) => Promise<Record<string, number>>)(
          page,
          taskId
        )
      );
    } finally {
      browser.close();
    }
  }
  return summarize(samples);
}

const results: Record<string, Record<string, number>> = {};
for (const name of Object.keys(scenarios)) {
  if (ONLY && !ONLY.includes(name)) continue;
  results[name] = await runScenario(name);
  console.info(name, JSON.stringify(results[name]));
}
if (Bun.env.SHINSA_PERF_OUT)
  await Bun.write(Bun.env.SHINSA_PERF_OUT, `${JSON.stringify(results, null, 2)}\n`);
