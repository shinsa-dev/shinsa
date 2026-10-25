import { rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { listTargets, ShellPage } from './shell-cdp.ts';
import { summarize } from './shell-stats.ts';

interface Paints {
  timeOrigin: number;
  firstContentfulPaint: number | null;
  largestContentfulPaint: number | null;
}

interface Launch {
  navigationStart: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  homeReady: number;
}

const APP_DIR = resolve(Bun.argv[2] ?? 'apps/desktop');
const ORIGIN = Bun.argv[3] ?? 'http://127.0.0.1:5620';
const RUNS = Number(Bun.env.SHELL_PERF_RUNS ?? 6);
const OUT = Bun.env.SHELL_PERF_OUT ?? null;
const USER_DATA = Bun.env.SHELL_PERF_USER_DATA ?? null;
const ELECTRON = resolve(
  Bun.env.SHELL_PERF_ELECTRON ??
    'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
);
const PORT = 9520;
const HOME_READY = `!!document.querySelector('main textarea')`;

const PAINTS = `new Promise((done) => {
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

async function findPage(deadline: number) {
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets(PORT)).find(
        (entry) => entry.type === 'page' && entry.url.startsWith(ORIGIN)
      );
      if (target) return ShellPage.open(target.webSocketDebuggerUrl);
    } catch {}
    await Bun.sleep(5);
  }
  throw new Error('The app never opened a page on the server.');
}

async function waitForHome(page: ShellPage, deadline: number) {
  while (Date.now() < deadline) {
    if (await page.evaluate<boolean>(HOME_READY)) return Date.now();
    await Bun.sleep(5);
  }
  throw new Error('Home never rendered.');
}

async function launchOnce(): Promise<Launch> {
  const startedAt = Date.now();
  const child = Bun.spawn([ELECTRON, APP_DIR, `--remote-debugging-port=${PORT}`], {
    env: { ...Bun.env, SHINSA_URL: ORIGIN },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  try {
    const deadline = startedAt + 30_000;
    const page = await findPage(deadline);
    const homeReady = await waitForHome(page, deadline);
    const paints = await page.evaluate<Paints>(PAINTS);
    page.close();
    const since = (offset: number | null) => paints.timeOrigin + (offset ?? 0) - startedAt;
    return {
      navigationStart: since(0),
      firstContentfulPaint: since(paints.firstContentfulPaint),
      largestContentfulPaint: since(paints.largestContentfulPaint),
      homeReady: homeReady - startedAt,
    };
  } finally {
    child.kill('SIGTERM');
    await child.exited;
    await Bun.sleep(500);
  }
}

if (USER_DATA)
  rmSync(join(homedir(), 'Library/Application Support', USER_DATA), { recursive: true, force: true });

const launches: Launch[] = [];
for (let run = 0; run < RUNS; run += 1) launches.push(await launchOnce());

const keys = ['navigationStart', 'firstContentfulPaint', 'largestContentfulPaint', 'homeReady'] as const;
const first = launches[0];
const rest = launches.slice(1);
console.log(`Electron start, ${APP_DIR} on ${ORIGIN}\n`);
console.log('| From launch to | First launch (empty cache) | Later launches (median) |');
console.log('|---|---|---|');
for (const key of keys) {
  const median = summarize(rest.map((launch) => launch[key])).median;
  console.log(`| ${key} | ${first?.[key].toFixed(0)} ms | ${median.toFixed(0)} ms |`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ appDir: APP_DIR, origin: ORIGIN, launches }, null, 2));
process.exit(0);
