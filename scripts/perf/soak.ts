import { writeFileSync } from 'node:fs';
import { launchChrome, listTargets, ShellPage } from './shell-cdp.ts';
import { type Frames, type SoakSample, serializeSoakRow, serializeSoakTable } from './soak-stats.ts';

interface TaskRow {
  handle: string;
  stage: string;
}

interface Metrics {
  TaskDuration: number;
  ScriptDuration: number;
  RecalcStyleCount: number;
  LayoutCount: number;
}

const ORIGIN = Bun.argv[2] ?? 'http://127.0.0.1:5640';
const LAPS = Number(Bun.env.SOAK_LAPS ?? 30);
const SAMPLE_EVERY = Number(Bun.env.SOAK_SAMPLE_EVERY ?? 10);
const TASK_COUNT = Number(Bun.env.SOAK_TASKS ?? 8);
const IDLE_MS = Number(Bun.env.SOAK_IDLE_MS ?? 5000);
const PUSHES = Number(Bun.env.SOAK_PUSHES ?? 20);
const FILES = Number(Bun.env.SOAK_FILES ?? 4);
const ATTACH = Bun.env.SOAK_ATTACH ?? null;
const OUT = Bun.env.SOAK_OUT ?? null;
const HOME_DONE = `location.pathname === '/' && !!document.querySelector('main textarea')`;

const SOAK_PROBE = String.raw`(() => {
  if (window.__soak) return;
  const soak = { socket: null, lastState: null };
  window.__soak = soak;
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      if (String(args[0]).includes('/ws/terminals/')) return;
      soak.socket = this;
      this.addEventListener('message', (event) => {
        const text = String(event.data);
        if (text.startsWith('{"type":"state"')) soak.lastState = text;
      });
    }
  };
  const textOf = (element) => (element.textContent || '').replace(/\s+/g, ' ').trim();
  const shown = (element) => !!element.offsetParent;
  soak.go = (path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  };
  soak.tab = (name) => [...document.querySelectorAll('[role=tab]')].find((tab) => shown(tab) && textOf(tab) === name) || null;
  soak.selectedTab = (name) => soak.tab(name)?.getAttribute('aria-selected') === 'true';
  soak.center = (element) => {
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  soak.scrollUp = async (times) => {
    for (let index = 0; index < times; index += 1) {
      const scrollers = [...document.querySelectorAll('main *')].filter(
        (element) => shown(element) && element.scrollHeight > element.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(element).overflowY)
      );
      for (const scroller of scrollers) {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll'));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  soak.openFiles = async (count) => {
    const files = [...document.querySelectorAll('[role=treeitem]')].filter((row) => shown(row) && !row.hasAttribute('aria-expanded')).slice(0, count);
    for (const file of files) {
      file.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return files.length;
  };
  soak.push = () => {
    if (!soak.lastState || !soak.socket) return false;
    const message = JSON.parse(soak.lastState);
    const tasks = Object.values(message.state.tasks);
    const task = tasks[tasks.length - 1];
    task.priority = task.priority === 'high' ? 'normal' : 'high';
    soak.socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    return true;
  };
  soak.frames = (windowMs) =>
    new Promise((resolve) => {
      let startedAt = null;
      const onClick = (event) => {
        if (startedAt === null) startedAt = event.timeStamp;
      };
      addEventListener('click', onClick, { capture: true });
      let last = performance.now();
      let longest = 0;
      let over34 = 0;
      let frames = 0;
      let paintedAt = null;
      const end = last + windowMs;
      const tick = (time) => {
        const gap = time - last;
        last = time;
        frames += 1;
        if (startedAt !== null) {
          longest = Math.max(longest, gap);
          if (gap > 34) over34 += 1;
          if (paintedAt === null && soak.done && soak.done()) paintedAt = time;
        }
        if (time < end) requestAnimationFrame(tick);
        else {
          removeEventListener('click', onClick, { capture: true });
          resolve({ clickToPaint: paintedAt === null || startedAt === null ? -1 : paintedAt - startedAt, longest, over34, frames });
        }
      };
      requestAnimationFrame(tick);
    });
})()`;

async function waitFor(page: ShellPage, expression: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      await page.evaluate<boolean>(`(() => { try { return !!(${expression}); } catch { return false; } })()`)
    )
      return true;
    await Bun.sleep(50);
  }
  return false;
}

async function click(page: ShellPage, point: { x: number; y: number }) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await Bun.sleep(120);
  for (const type of ['mousePressed', 'mouseReleased'])
    await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
}

async function readMetrics(page: ShellPage) {
  const { metrics } = await page.send<{ metrics: { name: string; value: number }[] }>(
    'Performance.getMetrics'
  );
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value])) as unknown as Metrics;
}

async function readHeapMb(page: ShellPage) {
  await page.send('HeapProfiler.collectGarbage');
  const heap = await page.send<{ usedSize: number }>('Runtime.getHeapUsage');
  return heap.usedSize / 1_000_000;
}

async function visitTab(page: ShellPage, name: string) {
  if (!(await waitFor(page, `__soak.tab(${JSON.stringify(name)})`, 3000))) return false;
  await page.evaluate(`__soak.tab(${JSON.stringify(name)}).click()`);
  return waitFor(page, `__soak.selectedTab(${JSON.stringify(name)})`, 5000);
}

async function visitTask(page: ShellPage, handle: string) {
  await page.evaluate(`__soak.go('/tasks/${handle}')`);
  if (
    !(await waitFor(
      page,
      `location.pathname === '/tasks/${handle}' && !!document.querySelector('[role=tab]')`
    ))
  )
    return;
  if (await visitTab(page, 'Chat')) await page.evaluate('__soak.scrollUp(6)');
  if (await visitTab(page, 'Code')) {
    await waitFor(page, `!!document.querySelector('[role=treeitem]')`, 5000);
    await page.evaluate(`__soak.openFiles(${FILES})`);
  }
  if (await visitTab(page, 'Review')) await Bun.sleep(200);
  await visitTab(page, 'Overview');
  await Bun.sleep(200);
}

async function measureTransition(page: ShellPage, handle: string, from: string, to: string) {
  await page.evaluate(`__soak.go('/tasks/${handle}')`);
  await visitTab(page, from);
  await Bun.sleep(600);
  const point = await page.evaluate<{ x: number; y: number } | null>(`__soak.center(__soak.tab('${to}'))`);
  if (!point) return null;
  await page.evaluate(`__soak.done = () => __soak.selectedTab('${to}')`);
  const frames = page.evaluate<Frames>('__soak.frames(1200)');
  await Bun.sleep(50);
  await click(page, point);
  return frames;
}

async function measure(page: ShellPage, lap: number, startedAt: number, pinned: string): Promise<SoakSample> {
  await page.evaluate(`__soak.go('/tasks/${pinned}')`);
  await visitTab(page, 'Chat');
  await Bun.sleep(1000);
  const nodes = await page.evaluate<number>(`document.getElementsByTagName('*').length`);
  const heapMb = await readHeapMb(page);
  const before = await readMetrics(page);
  const idleStart = performance.now();
  await Bun.sleep(IDLE_MS);
  const after = await readMetrics(page);
  const seconds = (performance.now() - idleStart) / 1000;
  const transition: Frames[] = [];
  for (const [from, to] of [
    ['Chat', 'Overview'],
    ['Overview', 'Chat'],
    ['Chat', 'Overview'],
    ['Overview', 'Chat'],
  ] as const) {
    const frames = await measureTransition(page, pinned, from, to);
    if (frames) transition.push(frames);
  }
  return {
    lap,
    minutes: (performance.now() - startedAt) / 60_000,
    nodes,
    heapMb,
    idleBusy: (after.TaskDuration - before.TaskDuration) / seconds,
    scriptBusy: (after.ScriptDuration - before.ScriptDuration) / seconds,
    recalcsPerSecond: (after.RecalcStyleCount - before.RecalcStyleCount) / seconds,
    layoutsPerSecond: (after.LayoutCount - before.LayoutCount) / seconds,
    transition,
  };
}

async function attach(port: string) {
  const target = (await listTargets(port)).find(
    (entry) => entry.type === 'page' && entry.url.startsWith(ORIGIN)
  );
  if (!target) throw new Error(`No page on ${ORIGIN} at port ${port}.`);
  const page = await ShellPage.open(target.webSocketDebuggerUrl);
  return { page, close: () => page.close() };
}

function openBrowser() {
  if (ATTACH) return attach(ATTACH);
  return launchChrome(1440, 1000);
}

async function runSoak() {
  const tasks = ((await (await fetch(`${ORIGIN}/api/tasks`)).json()) as { tasks: TaskRow[] }).tasks;
  const handles = tasks
    .filter((task) => task.stage !== 'done' && task.stage !== 'cancelled')
    .concat(tasks)
    .map((task) => task.handle)
    .filter((handle, index, all) => all.indexOf(handle) === index)
    .slice(0, TASK_COUNT);
  const pinned = Bun.env.SOAK_TASK ?? handles[0];
  if (!pinned) throw new Error(`No tasks on ${ORIGIN}.`);

  const browser = await openBrowser();
  const { page } = browser;
  await page.send('Page.enable');
  await page.send('Performance.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SOAK_PROBE });
  if (ATTACH) await page.evaluate(SOAK_PROBE);
  else await page.send('Page.navigate', { url: `${ORIGIN}/` });
  await waitFor(page, `window.__soak && ${HOME_DONE}`, 30_000);
  await Bun.sleep(1500);

  const startedAt = performance.now();
  const samples: SoakSample[] = [await measure(page, 0, startedAt, pinned)];
  for (let lap = 1; lap <= LAPS; lap += 1) {
    for (const handle of handles) {
      await visitTask(page, handle);
      for (let push = 0; push < PUSHES / handles.length; push += 1) {
        await page.evaluate('__soak.push()');
        await Bun.sleep(40);
      }
    }
    await page.evaluate(`__soak.go('/tasks')`);
    await Bun.sleep(300);
    await page.evaluate(`__soak.go('/')`);
    await waitFor(page, HOME_DONE);
    if (lap % SAMPLE_EVERY === 0 || lap === LAPS) {
      const sample = await measure(page, lap, startedAt, pinned);
      samples.push(sample);
      console.log(serializeSoakRow(sample));
    }
  }

  console.log(
    `\nSoak on ${ORIGIN}: ${LAPS} laps over ${handles.join(', ')}; idle and transitions on ${pinned}'s Chat\n`
  );
  console.log(serializeSoakTable(samples));
  if (OUT)
    writeFileSync(OUT, JSON.stringify({ origin: ORIGIN, laps: LAPS, handles, pinned, samples }, null, 2));
  browser.close();
}

await runSoak();
process.exit(0);
