import { appendFileSync } from 'node:fs';
import { createBrowser, median, type Page } from './code-cdp.ts';
import { CODE_PROBE } from './code-probe.ts';

interface Options {
  base: string;
  task: string;
  folder: string;
  label: string;
  tree: string[];
  files: string[];
  changes: string;
  switches: number;
  unified: boolean;
  out: string | null;
  width: number;
}

interface ChangedFile {
  path: string;
  status: string;
  binary: boolean;
  additions: number;
  deletions: number;
}

interface Opened {
  workMs: number | null;
  visibleMs: number | null;
  highlightedMs: number | null;
  long: { count: number; max: number; total: number };
}

interface Toggled {
  ms: number | null;
  work: number | null;
  long: number;
}

interface Entry {
  name: string;
  path: string;
  kind: string;
  size: number | null;
}

const CODE_EXTENSIONS = /\.(tsx?|jsx?|mjs|css|md|mdx|json|ya?ml|toml|go|rs|py|swift|sh)$/;

function readOptions(): Options {
  const args = new Map<string, string>();
  for (let index = 2; index < Bun.argv.length; index += 2)
    args.set(Bun.argv[index] ?? '', Bun.argv[index + 1] ?? '');
  return {
    base: args.get('--base') ?? 'http://127.0.0.1:5600',
    task: args.get('--task') ?? 'SMP-2',
    folder: args.get('--folder') ?? '',
    label: args.get('--label') ?? 'run',
    tree: (args.get('--tree') ?? '').split(',').filter(Boolean),
    files: (args.get('--files') ?? '').split(',').filter(Boolean),
    changes: args.get('--changes') ?? '',
    switches: Number(args.get('--switches') ?? 10),
    unified: args.get('--layout') === 'unified',
    out: args.get('--out') ?? null,
    width: Number(args.get('--width') ?? 1280),
  };
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

async function readText(options: Options, head: string, path: string) {
  const blob = await requestJson<{ content: string | null }>(
    `${options.base}/api/tasks/${options.task}/blob?ref=${head}&path=${encodeURIComponent(path)}`
  );
  return blob.content ?? '';
}

function pickSnippets(texts: Map<string, string>) {
  const snippets = new Map<string, string>();
  for (const [path, text] of texts) {
    const others = [...texts].filter(([other]) => other !== path).map(([, content]) => content);
    const line = text
      .split('\n')
      .slice(0, 30)
      .map((candidate) => candidate.trim().slice(0, 40))
      .find((candidate) => candidate.length >= 12 && others.every((content) => !content.includes(candidate)));
    if (line) snippets.set(path, line);
  }
  return snippets;
}

function rowSelector(path: string) {
  return `[role=treeitem][aria-label=${JSON.stringify(path)}]`;
}

async function openPage(page: Page, url: string, width: number) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await page.send('Page.navigate', { url });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await Bun.sleep(50);
    const ready = await page.evaluate<string>('document.readyState').catch(() => 'loading');
    if (ready === 'complete') break;
  }
  await page.evaluate(CODE_PROBE);
}

async function pressAt(page: Page, x: number, y: number, hoverMs: number) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  if (hoverMs > 0) await Bun.sleep(hoverMs);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function waitForSelector(page: Page, selector: string, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await page.evaluate<boolean>(`Boolean(window.__code.rect(${JSON.stringify(selector)}))`)) return true;
    await Bun.sleep(50);
  }
  return false;
}

async function revealRow(page: Page, selector: string) {
  if (await page.evaluate<boolean>(`window.__code.reveal(${JSON.stringify(selector)})`)) await Bun.sleep(100);
}

async function openRow(page: Page, path: string, snippet: string, hoverMs: number) {
  await revealRow(page, rowSelector(path));
  const at = await page.evaluate<{ x: number; y: number } | null>(
    `window.__code.rect(${JSON.stringify(rowSelector(path))})`
  );
  if (!at) return null;
  await page.evaluate(`window.__watch = window.__code.watchOpen(${JSON.stringify(snippet)}); true`);
  await pressAt(page, at.x, at.y, hoverMs);
  const opened = await page.evaluate<Opened>('window.__watch');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500 });
  await Bun.sleep(250);
  return opened;
}

async function measureStyleFrames(page: Page, selector: string, run: () => Promise<void>) {
  await page.evaluate(
    `window.__style = window.__code.watchStyle(${JSON.stringify(selector)}, 'backgroundColor', 24); true`
  );
  await Bun.sleep(20);
  await run();
  const watched = await page.evaluate<{
    samples: { at: number; value: string | null }[];
    over: number;
    click: number;
  }>('window.__style');
  const event = Math.max(watched.over, watched.click);
  const after = watched.samples.filter((sample) => sample.at > event);
  const before = watched.samples.filter((sample) => sample.at <= event).at(-1)?.value ?? null;
  const final = after.at(-1)?.value ?? null;
  return { frames: after.findIndex((sample) => sample.value === final), changed: before !== final };
}

function summarizeOpens(opens: (Opened | null)[]) {
  const done = opens.filter((open): open is Opened => open !== null);
  const visible = done.flatMap((open) => (open.visibleMs === null ? [] : [open.visibleMs]));
  const highlighted = done.flatMap((open) => (open.highlightedMs === null ? [] : [open.highlightedMs]));
  const work = done.flatMap((open) => (open.workMs === null ? [] : [open.workMs]));
  return {
    n: done.length,
    workMedian: median(work),
    workMax: Math.max(0, ...work),
    visibleMedian: median(visible),
    visibleMax: Math.max(0, ...visible),
    highlightedMedian: median(highlighted),
    longMax: Math.max(0, ...done.map((open) => open.long.max)),
  };
}

async function measureFiles(page: Page, options: Options, head: string) {
  const tree = await requestJson<{ entries: Entry[] }>(
    `${options.base}/api/tasks/${options.task}/tree?ref=${head}&dir=${encodeURIComponent(options.folder)}`
  );
  const files = tree.entries.filter(
    (entry) =>
      entry.kind === 'file' &&
      CODE_EXTENSIONS.test(entry.name) &&
      (entry.size ?? 0) > 20 &&
      (entry.size ?? 0) < 120_000
  );
  const [anchor, ...rest] = files;
  if (!anchor) throw new Error(`No files to open in ${options.folder}.`);
  await openPage(
    page,
    `${options.base}/tasks/${options.task}?tab=code&mode=files&file=${encodeURIComponent(anchor.path)}`,
    options.width
  );
  await waitForSelector(page, rowSelector(anchor.path));
  const texts = new Map<string, string>();
  for (const entry of files) texts.set(entry.path, await readText(options, head, entry.path));
  const snippets = pickSnippets(texts);
  await page.evaluate(`window.__code.watchOpen(${JSON.stringify(snippets.get(anchor.path) ?? '')}, 15000)`);
  await Bun.sleep(2500);
  await revealRow(page, rowSelector(anchor.path));
  const rendered = new Set(
    await page.evaluate<string[]>(
      `[...document.querySelectorAll('[role=treeitem]')].map((row) => row.getAttribute('aria-label'))`
    )
  );
  const shown = rest.filter((entry) => rendered.has(entry.path) && snippets.has(entry.path));
  const cold = shown.filter((_, index) => index % 4 === 3).slice(0, 6);
  const prefetched = shown.filter((_, index) => index % 4 === 1).slice(0, 6);
  const hoverRow = rowSelector(shown.at(-1)?.path ?? anchor.path);
  await revealRow(page, hoverRow);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500 });
  await Bun.sleep(300);
  const hover = await measureStyleFrames(page, hoverRow, async () => {
    const at = await page.evaluate<{ x: number; y: number }>(
      `window.__code.rect(${JSON.stringify(hoverRow)})`
    );
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    await Bun.sleep(500);
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500 });
  await Bun.sleep(200);
  const coldOpens: (Opened | null)[] = [];
  for (const entry of cold)
    coldOpens.push(await openRow(page, entry.path, snippets.get(entry.path) ?? '', 0));
  const warmOpens: (Opened | null)[] = [];
  for (const entry of [...cold.slice(0, 4), ...cold.slice(0, 4)])
    warmOpens.push(await openRow(page, entry.path, snippets.get(entry.path) ?? '', 0));
  const prefetchedOpens: (Opened | null)[] = [];
  for (const entry of prefetched)
    prefetchedOpens.push(await openRow(page, entry.path, snippets.get(entry.path) ?? '', 400));
  await revealRow(page, rowSelector(cold[1]?.path ?? anchor.path));
  const selected = await measureStyleFrames(page, rowSelector(cold[1]?.path ?? anchor.path), async () => {
    const at = await page.evaluate<{ x: number; y: number }>(
      `window.__code.rect(${JSON.stringify(rowSelector(cold[1]?.path ?? anchor.path))})`
    );
    await pressAt(page, at.x, at.y, 0);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500 });
    await Bun.sleep(500);
  });
  return {
    cold: summarizeOpens(coldOpens),
    warm: summarizeOpens(warmOpens),
    prefetched: summarizeOpens(prefetchedOpens),
    hoverFrames: hover.changed ? hover.frames : null,
    selectedFrames: selected.changed ? selected.frames : null,
  };
}

function pickChangeSnippet(head: string, base: string, others: string[]) {
  const headLines = head.split('\n');
  const baseLines = base.split('\n');
  const first = headLines.findIndex((line, index) => line !== baseLines[index]);
  const start = Math.max(0, first);
  return headLines
    .slice(start, start + 3)
    .map((line) => line.trim().slice(0, 40))
    .find((line) => line.length >= 12 && others.every((text) => !text.includes(line)));
}

async function measureChanges(page: Page, options: Options, refs: { head: string; base: string }) {
  const diff = await requestJson<{ files: ChangedFile[] }>(`${options.base}/api/tasks/${options.task}/diff`);
  const candidates = diff.files
    .filter(
      (file) =>
        file.status === 'modified' &&
        !file.binary &&
        file.path.startsWith(options.changes) &&
        CODE_EXTENSIONS.test(file.path)
    )
    .slice(0, options.switches + 1);
  const texts = new Map<string, { head: string; base: string }>();
  for (const file of candidates)
    texts.set(file.path, {
      head: await readText(options, refs.head, file.path),
      base: await readText(options, refs.base, file.path),
    });
  const chosen = candidates.flatMap((file) => {
    const own = texts.get(file.path);
    if (!own) return [];
    const others = [...texts]
      .filter(([path]) => path !== file.path)
      .flatMap(([, text]) => [text.head, text.base]);
    const snippet = pickChangeSnippet(own.head, own.base, others);
    return snippet ? [{ path: file.path, snippet }] : [];
  });
  const [anchor, ...rest] = chosen;
  if (!anchor) throw new Error(`No changed files to switch between under ${options.changes}.`);
  const url = `${options.base}/tasks/${options.task}?tab=code&mode=changes&diff=1&file=${encodeURIComponent(anchor.path)}`;
  await openPage(page, url, options.width);
  await page.evaluate(`localStorage.setItem('shinsa.code-unified', '${options.unified}'); true`);
  await openPage(page, url, options.width);
  await waitForSelector(page, rowSelector(anchor.path));
  await page.evaluate(`window.__code.watchOpen(${JSON.stringify(anchor.snippet)}, 15000)`);
  await Bun.sleep(2000);
  const split = await page.evaluate<boolean>(`Boolean(document.querySelector('.cm-mergeView'))`);
  const passes: (Opened | null)[][] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    const opens: (Opened | null)[] = [];
    for (const file of [...rest, anchor]) opens.push(await openRow(page, file.path, file.snippet, 400));
    passes.push(opens);
  }
  return {
    split,
    files: chosen.length,
    first: summarizeOpens(passes[0] ?? []),
    again: summarizeOpens([...(passes[1] ?? []), ...(passes[2] ?? [])]),
  };
}

async function measureTree(page: Page, options: Options) {
  await openPage(page, `${options.base}/tasks/${options.task}?tab=code&mode=files`, options.width);
  await waitForSelector(page, '[role=tree][aria-label=Files] [role=treeitem]');
  await Bun.sleep(2000);
  const expands: Toggled[] = [];
  const collapses: Toggled[] = [];
  const hovered: Toggled[] = [];
  for (const [index, folder] of options.tree.entries()) {
    await revealRow(page, rowSelector(folder));
    const at = await page.evaluate<{ x: number; y: number } | null>(
      `window.__code.rect(${JSON.stringify(rowSelector(folder))})`
    );
    if (!at) continue;
    const child = `[role=treeitem][aria-label^=${JSON.stringify(`${folder}/`)}]`;
    await page.evaluate(
      `window.__expand = window.__code.watchSelector(${JSON.stringify(child)}, true); true`
    );
    await pressAt(page, at.x, at.y, index % 2 === 0 ? 0 : 400);
    (index % 2 === 0 ? expands : hovered).push(await page.evaluate<Toggled>('window.__expand'));
    await Bun.sleep(300);
    await page.evaluate(
      `window.__collapse = window.__code.watchSelector(${JSON.stringify(child)}, false); true`
    );
    await pressAt(page, at.x, at.y, 0);
    collapses.push(await page.evaluate<Toggled>('window.__collapse'));
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500 });
    await Bun.sleep(300);
  }
  const summarize = (list: Toggled[]) => ({
    n: list.length,
    work: median(list.flatMap((item) => (item.work === null ? [] : [item.work]))),
    median: median(list.flatMap((item) => (item.ms === null ? [] : [item.ms]))),
    max: Math.max(0, ...list.flatMap((item) => (item.ms === null ? [] : [item.ms]))),
    longMax: Math.max(0, ...list.map((item) => item.long)),
  });
  for (const folder of options.tree.slice(0, 30)) {
    const at = await page.evaluate<{ x: number; y: number } | null>(
      `window.__code.rect(${JSON.stringify(rowSelector(folder))})`
    );
    if (at) {
      await pressAt(page, at.x, at.y, 0);
      await Bun.sleep(120);
    }
  }
  await Bun.sleep(1500);
  const rows = await page.evaluate<number>(
    `(() => { const list = document.querySelector('[role=tree][aria-label=Files] > div'); return list ? Math.round(list.getBoundingClientRect().height / 22) : 0; })()`
  );
  const scroll = await page.evaluate<{
    frames: number;
    p95: number;
    max: number;
    long: { max: number; count: number };
  }>(`window.__code.frames(async () => {
    const viewport = document.querySelector('[role=tree][aria-label=Files]').closest('[data-slot=scroll-area-viewport]');
    for (let index = 0; index < 120; index += 1) { viewport.scrollTop += 700; await new Promise((r) => requestAnimationFrame(r)); }
    for (let index = 0; index < 120; index += 1) { viewport.scrollTop -= 700; await new Promise((r) => requestAnimationFrame(r)); }
  })`);
  return {
    expand: summarize(expands),
    expandHovered: summarize(hovered),
    collapse: summarize(collapses),
    rows,
    scroll: {
      frames: scroll.frames,
      p95: scroll.p95,
      max: scroll.max,
      longMax: scroll.long.max,
      longCount: scroll.long.count,
    },
  };
}

async function measureBigFiles(page: Page, options: Options, head: string) {
  const [first, ...rest] = options.files;
  if (!first) return [];
  await openPage(
    page,
    `${options.base}/tasks/${options.task}?tab=code&mode=files&file=${encodeURIComponent(first)}`,
    options.width
  );
  await Bun.sleep(4000);
  const results: Record<string, unknown>[] = [];
  let previous = await readText(options, head, first);
  for (const path of rest) {
    const text = await readText(options, head, path);
    const snippet =
      text
        .split('\n')
        .slice(0, 30)
        .map((line) => line.trim().slice(0, 40))
        .find((line) => line.length >= 12 && !previous.includes(line)) ?? '';
    previous = text;
    await page.evaluate(
      `window.__watch = window.__code.watchOpen(${JSON.stringify(snippet)}, 20000); window.__code.navigate(${JSON.stringify(
        `/tasks/${options.task}?tab=code&mode=files&file=${encodeURIComponent(path)}`
      )}); true`
    );
    const opened = await page.evaluate<Opened>('window.__watch');
    const scroll = await page.evaluate<{
      frames: number;
      p95: number;
      max: number;
      long: { max: number };
    }>(`window.__code.frames(async () => {
      const scroller = document.querySelector('.cm-scroller');
      for (let index = 0; index < 60; index += 1) { scroller.scrollTop += 2000; await new Promise((r) => requestAnimationFrame(r)); }
    })`);
    results.push({
      path,
      size: text.length,
      ...opened,
      scrollP95: scroll.p95,
      scrollMax: scroll.max,
      scrollLongMax: scroll.long.max,
    });
    await Bun.sleep(1000);
  }
  return results;
}

async function main() {
  const options = readOptions();
  const refs = await requestJson<{ head: string; base: string }>(
    `${options.base}/api/tasks/${options.task}/refs`
  );
  const browser = await createBrowser(options.width, 900);
  try {
    const result: Record<string, unknown> = {
      label: options.label,
      task: options.task,
      at: new Date().toISOString(),
    };
    if (options.folder) result.files = await measureFiles(browser.page, options, refs.head);
    if (options.tree.length > 0) result.tree = await measureTree(browser.page, options);
    if (options.files.length > 0) result.big = await measureBigFiles(browser.page, options, refs.head);
    if (options.changes) result.changes = await measureChanges(browser.page, options, refs);
    await browser.page.send('HeapProfiler.enable');
    for (let round = 0; round < 3; round += 1) await browser.page.send('HeapProfiler.collectGarbage');
    result.heapMb =
      Math.round(
        ((await browser.page.send<{ usedSize: number }>('Runtime.getHeapUsage')).usedSize / 1048576) * 10
      ) / 10;
    const line = JSON.stringify(result);
    console.log(line);
    if (options.out) appendFileSync(options.out, `${line}\n`);
  } finally {
    browser.close();
  }
}

await main();
