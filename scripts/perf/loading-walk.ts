import { writeFileSync } from 'node:fs';
import { LOADING_PROBE } from './loading-probe.ts';
import { listFailures, serializeWaitTable, summarizeWaits, type WaitSample } from './loading-stats.ts';
import { launchChrome, type ShellPage } from './shell-cdp.ts';

const ORIGIN = Bun.argv[2] ?? 'http://127.0.0.1:5720';
const WIDTHS = (Bun.env.LOADING_WALK_WIDTHS ?? '1440,900').split(',').map(Number);
const TASKS = Number(Bun.env.LOADING_WALK_TASKS ?? 2);
const OUT = Bun.env.LOADING_WALK_OUT ?? null;
const WARM_UP = Bun.env.LOADING_WALK_WARM_UP === '1';
const HOVER_MS = 120;
const SETTLE_MS = 700;
const META = 4;
const SHIFT = 8;

const HOME = `document.querySelector('header [aria-label="Home"]') || __loading.byPrefix('header button', '^Shinsa') || __loading.byText('nav [data-highlight-item]', 'New task')`;
const HOME_DONE = `location.pathname === '/' && !!document.querySelector('main textarea')`;

const cold = new Set<string>();

interface Key {
  key: string;
  code: string;
  keyCode: number;
  modifiers?: number;
}

async function waitFor(page: ShellPage, expression: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const done = await page.evaluate<boolean>(
      `(() => { try { return !!(${expression}); } catch { return false; } })()`
    );
    if (done) return true;
    await Bun.sleep(40);
  }
  console.warn(`Timed out waiting for ${expression}`);
  return false;
}

async function press(page: ShellPage, key: Key) {
  const base = {
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.keyCode,
    modifiers: key.modifiers ?? 0,
  };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function typeText(page: ShellPage, text: string) {
  for (const character of text) {
    await page.send('Input.insertText', { text: character });
    await Bun.sleep(60);
  }
}

async function click(page: ShellPage, target: string) {
  const point = await page.evaluate<{ x: number; y: number } | null>(
    `__loading.center(${JSON.stringify(target)})`
  );
  if (!point) return false;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await Bun.sleep(HOVER_MS);
  for (const kind of ['mousePressed', 'mouseReleased'])
    await page.send('Input.dispatchMouseEvent', { type: kind, ...point, button: 'left', clickCount: 1 });
  return true;
}

async function step(page: ShellPage, label: string, run: () => Promise<unknown>, settleMs = SETTLE_MS) {
  await page.evaluate(`__loading.begin(${JSON.stringify(label)})`);
  const ran = await run();
  if (ran === false) console.warn(`Skipped ${label} at ${await page.evaluate<string>('location.href')}`);
  await Bun.sleep(settleMs);
}

async function goHome(page: ShellPage, prefix: string) {
  await step(page, `${prefix}Home`, async () => (await click(page, HOME)) && waitFor(page, HOME_DONE));
}

async function pickRef(page: ShellPage, prefix: string, label: string) {
  await step(page, `${prefix}Code: ${label}`, async () => {
    const trigger = `__loading.rendered('[aria-label="Show the code at"]')[0]`;
    const options = `__loading.visible('[role=option]').length > 0`;
    if (!(await click(page, trigger))) return false;
    if (!(await waitFor(page, options, 2000))) {
      await click(page, trigger);
      await waitFor(page, options);
    }
    const picked = await click(
      page,
      `__loading.visible('[role=option]').find((option) => __loading.textOf(option).startsWith(${JSON.stringify(label)}))`
    );
    if (!picked) await press(page, { key: 'Escape', code: 'Escape', keyCode: 27 });
    return picked;
  });
}

async function walkCode(page: ShellPage, prefix: string) {
  const treeItem = (index: number) =>
    `__loading.visible('[role=tree][aria-label="Changed files"] [role=treeitem]:not([aria-expanded])')[${index}]`;
  for (const index of [1, 2, 0])
    await step(page, `${prefix}Code: open a changed file`, () => click(page, treeItem(index)));
  await step(page, `${prefix}Code: Files`, () => click(page, `__loading.tab('Files')`));
  await step(page, `${prefix}Code: open a folder`, () =>
    click(
      page,
      `__loading.visible('[role=tree][aria-label="Files"] [role=treeitem][aria-expanded="false"]')[0]`
    )
  );
  for (const index of [0, 1, 2])
    await step(page, `${prefix}Code: open a file from the tree`, () =>
      click(
        page,
        `__loading.visible('[role=tree][aria-label="Files"] [role=treeitem]:not([aria-expanded])')[${index}]`
      )
    );
  await step(page, `${prefix}Code: Changes`, () => click(page, `__loading.tab('Changes')`));
  await step(page, `${prefix}Code: ⌘P`, async () => {
    await press(page, { key: 'p', code: 'KeyP', keyCode: 80, modifiers: META });
    return waitFor(page, `!!document.querySelector('[aria-label="Go to file"]')`);
  });
  await step(page, `${prefix}Code: ⌘P query`, () => typeText(page, 'index'));
  const coldPick = `${prefix}Code: open a file from ⌘P (cold)`;
  cold.add(coldPick);
  await step(page, coldPick, () => press(page, { key: 'Enter', code: 'Enter', keyCode: 13 }));
  if (await page.evaluate<boolean>(`!!document.querySelector('[aria-label="Go to file"]')`))
    await press(page, { key: 'Escape', code: 'Escape', keyCode: 27 });
  for (const label of ['Base', 'Working copy', 'Head of the branch']) await pickRef(page, prefix, label);
  await step(page, `${prefix}Code: search`, async () => {
    await press(page, { key: 'f', code: 'KeyF', keyCode: 70, modifiers: META | SHIFT });
    return waitFor(page, `document.activeElement?.placeholder === 'Search in files'`);
  });
  const coldSearch = `${prefix}Code: search (cold)`;
  cold.add(coldSearch);
  await step(page, coldSearch, () => typeText(page, 'export'), 1500);
  await step(page, `${prefix}Code: open a match`, () =>
    click(
      page,
      `__loading.visible('[role=tree][aria-label="Search results"] [role=treeitem]:not([aria-expanded])')[0]`
    )
  );
}

async function walkTask(page: ShellPage, prefix: string, handle: string) {
  await step(
    page,
    `${prefix}Home → All tasks`,
    async () =>
      (await click(
        page,
        `[...document.querySelectorAll('header button')].find((button) => button.textContent === 'Tasks')`
      )) && waitFor(page, `location.pathname === '/tasks'`)
  );
  await step(page, `${prefix}All tasks → task`, async () => {
    const row = `__loading.rendered('main [role=button]').find((row) => [...row.querySelectorAll('span')].some((part) => __loading.textOf(part) === ${JSON.stringify(handle)}))`;
    if (await click(page, row)) return waitFor(page, `location.pathname.startsWith('/tasks/')`);
    await press(page, { key: 'k', code: 'KeyK', keyCode: 75, modifiers: META });
    await waitFor(page, `!!document.querySelector('[cmdk-input]')`);
    await typeText(page, handle);
    await Bun.sleep(300);
    await press(page, { key: 'Enter', code: 'Enter', keyCode: 13 });
    return waitFor(page, `location.pathname.startsWith('/tasks/')`);
  });
  for (const tab of ['Overview', 'Review', 'Code', 'Chat']) {
    const present = await page.evaluate<boolean>(`!!__loading.tab(${JSON.stringify(tab)})`);
    if (!present) continue;
    await step(
      page,
      `${prefix}Task: ${tab}`,
      async () =>
        (await click(page, `__loading.tab(${JSON.stringify(tab)})`)) &&
        waitFor(page, `__loading.selectedTab(${JSON.stringify(tab)})`)
    );
    if (tab === 'Code') await walkCode(page, prefix);
  }
  await step(page, `${prefix}Task: Overview again`, () => click(page, `__loading.tab('Overview')`));
}

async function countChangedFiles(handle: string) {
  const task = `${ORIGIN}/api/tasks/${encodeURIComponent(handle)}`;
  const refs = await fetch(`${task}/refs`);
  if (!refs.ok) return 0;
  const { base, head } = (await refs.json()) as { base: string | null; head: string };
  if (!base) return 0;
  const response = await fetch(`${task}/diff?base=${base}&head=${head}`);
  if (!response.ok) return 0;
  return ((await response.json()) as { files: unknown[] }).files.length;
}

async function pickHandles(tasks: readonly { handle: string }[]) {
  if (Bun.env.LOADING_WALK_HANDLES) return Bun.env.LOADING_WALK_HANDLES.split(',');
  const picked: string[] = [];
  for (const task of tasks) {
    if (picked.length === TASKS) break;
    if ((await countChangedFiles(task.handle)) > 0) picked.push(task.handle);
  }
  const rest = tasks.map((task) => task.handle).filter((handle) => !picked.includes(handle));
  return [...picked, ...rest].slice(0, TASKS);
}

async function walk(width: number) {
  const browser = await launchChrome(width, 1000);
  const { page } = browser;
  const prefix = `${width}px · `;
  await page.send('Page.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: LOADING_PROBE });
  await page.send('Page.navigate', { url: `${ORIGIN}/` });
  await waitFor(page, `window.__loading && ${HOME_DONE}`, 20_000);
  await Bun.sleep(1500);
  const handles = await pickHandles(await page.evaluate<{ handle: string }[]>('__loading.pickTasks()'));
  for (const handle of handles) {
    await walkTask(page, `${prefix}${handle} · `, handle);
    await goHome(page, prefix);
  }
  await step(
    page,
    `${prefix}Home → Settings`,
    async () =>
      (await click(page, `document.querySelector('header button[aria-label="Settings"]')`)) &&
      waitFor(page, `location.pathname === '/settings'`)
  );
  await goHome(page, prefix);
  const samples = await page.evaluate<WaitSample[]>('__loading.flush()');
  for (let pass = 0; pass < 3; pass += 1) await page.send('HeapProfiler.collectGarbage');
  const { usedSize } = await page.send<{ usedSize: number }>('Runtime.getHeapUsage');
  console.log(`${width}px: JS heap after the walk ${(usedSize / 1024 / 1024).toFixed(1)} MB`);
  browser.close();
  return samples;
}

const samples: WaitSample[] = [];
for (const width of WIDTHS) samples.push(...(await walk(width)));
const rows = summarizeWaits(samples, cold);
console.log(`Loading states seen on ${ORIGIN}\n\n${serializeWaitTable(rows)}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ origin: ORIGIN, rows, samples }, null, 2));
const failures = listFailures(rows);
if (WARM_UP) {
  console.log(`\nWarm-up pass: ${failures.length} loading state(s) showed; this pass does not count.`);
  process.exit(0);
}
if (failures.length > 0) {
  console.error(`\n${failures.length} loading state(s) showed in normal use.`);
  process.exit(1);
}
process.exit(0);
