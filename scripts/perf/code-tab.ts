import { BunRuntime } from '@effect/platform-bun';
import { Console, DateTime, Duration, Effect, Schedule, Schema } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { type CdpPage, Chromium, ChromiumLayer } from '../kit/chromium/index.ts';
import { HeapUsage, Point, PointOrNull } from './browser/schema.ts';
import { CODE_PROBE } from './code-probe.ts';
import {
  AWAY,
  Blob,
  ChangedFiles,
  CODE_EXTENSIONS,
  CODE_HEIGHT,
  type CodeTabOptions,
  FrameRun,
  MEBIBYTE,
  NothingToOpen,
  Opened,
  Refs,
  RowLabels,
  StyleWatch,
  Toggled,
  TreeEntries,
} from './code/schema.ts';
import { median } from './content-stats.ts';
import { appendReport } from './report/write.ts';

function readOptions(): CodeTabOptions {
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

function rowSelector(path: string) {
  return `[role=treeitem][aria-label=${JSON.stringify(path)}]`;
}

function summarizeOpens(opens: readonly (Opened | null)[]) {
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

function summarizeToggles(list: readonly Toggled[]) {
  const times = list.flatMap((item) => (item.ms === null ? [] : [item.ms]));
  return {
    n: list.length,
    work: median(list.flatMap((item) => (item.work === null || item.work === undefined ? [] : [item.work]))),
    median: median(times),
    max: Math.max(0, ...times),
    longMax: Math.max(0, ...list.map((item) => item.long)),
  };
}

const program = Effect.gen(function* () {
  const options = readOptions();
  const chromium = yield* Chromium;
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
  const away = (page: CdpPage) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...AWAY });

  const requestJson = <A>(url: string, schema: Schema.Decoder<A>) =>
    http.get(url).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)));

  const readText = Effect.fn('CodeTab.readText')(function* (head: string, path: string) {
    const blob = yield* requestJson(
      `${options.base}/api/tasks/${options.task}/blob?ref=${head}&path=${encodeURIComponent(path)}`,
      Blob
    );
    return blob.content ?? '';
  });

  const openPage = Effect.fn('CodeTab.openPage')(function* (page: CdpPage, url: string) {
    yield* page.send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: CODE_HEIGHT,
      deviceScaleFactor: 2,
      mobile: false,
    });
    yield* page.send('Page.navigate', { url });
    yield* Effect.sleep(Duration.millis(50)).pipe(
      Effect.andThen(page.evaluate('document.readyState', Schema.String)),
      Effect.orElseSucceed(() => 'loading'),
      Effect.repeat({ schedule: Schedule.recurs(199), until: (ready) => ready === 'complete' })
    );
    yield* page.evaluate(CODE_PROBE, Schema.Unknown);
  });

  const pressAt = Effect.fn('CodeTab.pressAt')(function* (
    page: CdpPage,
    x: number,
    y: number,
    hoverMs: number
  ) {
    yield* page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    if (hoverMs > 0) yield* Effect.sleep(Duration.millis(hoverMs));
    yield* page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    yield* page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  });

  const waitForSelector = (page: CdpPage, selector: string) =>
    page.waitForExpression(`window.__code.rect(${JSON.stringify(selector)})`);

  const revealRow = Effect.fn('CodeTab.revealRow')(function* (page: CdpPage, selector: string) {
    if (yield* page.evaluate(`window.__code.reveal(${JSON.stringify(selector)})`, Schema.Boolean))
      yield* Effect.sleep(Duration.millis(100));
  });

  const selectRect = (page: CdpPage, selector: string) =>
    page.evaluate(`window.__code.rect(${JSON.stringify(selector)})`, PointOrNull);

  const openRow = Effect.fn('CodeTab.openRow')(function* (
    page: CdpPage,
    path: string,
    snippet: string,
    hoverMs: number
  ) {
    yield* revealRow(page, rowSelector(path));
    const at = yield* selectRect(page, rowSelector(path));
    if (!at) return null;
    yield* page.evaluate(
      `window.__watch = window.__code.watchOpen(${JSON.stringify(snippet)}); true`,
      Schema.Unknown
    );
    yield* pressAt(page, at.x, at.y, hoverMs);
    const opened = yield* page.evaluate('window.__watch', Opened);
    yield* away(page);
    yield* Effect.sleep(Duration.millis(250));
    return opened;
  });

  const openRows = (page: CdpPage, rows: readonly { path: string; snippet: string }[], hoverMs: number) =>
    Effect.forEach(rows, (row) => openRow(page, row.path, row.snippet, hoverMs));

  const measureStyleFrames = Effect.fn('CodeTab.measureStyleFrames')(function* <E>(
    page: CdpPage,
    selector: string,
    run: Effect.Effect<unknown, E>
  ) {
    yield* page.evaluate(
      `window.__style = window.__code.watchStyle(${JSON.stringify(selector)}, 'backgroundColor', 24); true`,
      Schema.Unknown
    );
    yield* Effect.sleep(Duration.millis(20));
    yield* run;
    const watched = yield* page.evaluate('window.__style', StyleWatch);
    const event = Math.max(watched.over, watched.click);
    const after = watched.samples.filter((sample) => sample.at > event);
    const before = watched.samples.filter((sample) => sample.at <= event).at(-1)?.value ?? null;
    const final = after.at(-1)?.value ?? null;
    return { frames: after.findIndex((sample) => sample.value === final), changed: before !== final };
  });

  const measureFiles = Effect.fn('CodeTab.measureFiles')(function* (page: CdpPage, head: string) {
    const tree = yield* requestJson(
      `${options.base}/api/tasks/${options.task}/tree?ref=${head}&dir=${encodeURIComponent(options.folder)}`,
      TreeEntries
    );
    const files = tree.entries.filter(
      (entry) =>
        entry.kind === 'file' &&
        CODE_EXTENSIONS.test(entry.name) &&
        (entry.size ?? 0) > 20 &&
        (entry.size ?? 0) < 120_000
    );
    const [anchor, ...rest] = files;
    if (!anchor) return yield* new NothingToOpen({ message: `No files to open in ${options.folder}.` });
    yield* openPage(
      page,
      `${options.base}/tasks/${options.task}?tab=code&mode=files&file=${encodeURIComponent(anchor.path)}`
    );
    yield* waitForSelector(page, rowSelector(anchor.path));
    const texts = new Map<string, string>();
    for (const entry of files) texts.set(entry.path, yield* readText(head, entry.path));
    const snippets = pickSnippets(texts);
    const withSnippet = (path: string) => ({ path, snippet: snippets.get(path) ?? '' });
    yield* page.evaluate(
      `window.__code.watchOpen(${JSON.stringify(snippets.get(anchor.path) ?? '')}, 15000)`,
      Schema.Unknown
    );
    yield* Effect.sleep(Duration.millis(2500));
    yield* revealRow(page, rowSelector(anchor.path));
    const rendered = new Set(
      yield* page.evaluate(
        `[...document.querySelectorAll('[role=treeitem]')].map((row) => row.getAttribute('aria-label'))`,
        RowLabels
      )
    );
    const shown = rest.filter((entry) => rendered.has(entry.path) && snippets.has(entry.path));
    const cold = shown.filter((_, index) => index % 4 === 3).slice(0, 6);
    const prefetched = shown.filter((_, index) => index % 4 === 1).slice(0, 6);
    const hoverRow = rowSelector(shown.at(-1)?.path ?? anchor.path);
    yield* revealRow(page, hoverRow);
    yield* away(page);
    yield* Effect.sleep(Duration.millis(300));
    const hover = yield* measureStyleFrames(
      page,
      hoverRow,
      Effect.gen(function* () {
        const at = yield* page.evaluate(`window.__code.rect(${JSON.stringify(hoverRow)})`, Point);
        yield* page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
        yield* Effect.sleep(Duration.millis(500));
      })
    );
    yield* away(page);
    yield* Effect.sleep(Duration.millis(200));
    const coldOpens = yield* openRows(
      page,
      cold.map((entry) => withSnippet(entry.path)),
      0
    );
    const warmOpens = yield* openRows(
      page,
      [...cold.slice(0, 4), ...cold.slice(0, 4)].map((entry) => withSnippet(entry.path)),
      0
    );
    const prefetchedOpens = yield* openRows(
      page,
      prefetched.map((entry) => withSnippet(entry.path)),
      400
    );
    const selectedRow = rowSelector(cold[1]?.path ?? anchor.path);
    yield* revealRow(page, selectedRow);
    const selected = yield* measureStyleFrames(
      page,
      selectedRow,
      Effect.gen(function* () {
        const at = yield* page.evaluate(`window.__code.rect(${JSON.stringify(selectedRow)})`, Point);
        yield* pressAt(page, at.x, at.y, 0);
        yield* away(page);
        yield* Effect.sleep(Duration.millis(500));
      })
    );
    return {
      cold: summarizeOpens(coldOpens),
      warm: summarizeOpens(warmOpens),
      prefetched: summarizeOpens(prefetchedOpens),
      hoverFrames: hover.changed ? hover.frames : null,
      selectedFrames: selected.changed ? selected.frames : null,
    };
  });

  const measureChanges = Effect.fn('CodeTab.measureChanges')(function* (page: CdpPage, refs: Refs) {
    const diff = yield* requestJson(`${options.base}/api/tasks/${options.task}/diff`, ChangedFiles);
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
        head: yield* readText(refs.head, file.path),
        base: yield* readText(refs.base, file.path),
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
    if (!anchor)
      return yield* new NothingToOpen({
        message: `No changed files to switch between under ${options.changes}.`,
      });
    const url = `${options.base}/tasks/${options.task}?tab=code&mode=changes&diff=1&file=${encodeURIComponent(anchor.path)}`;
    yield* openPage(page, url);
    yield* page.evaluate(
      `localStorage.setItem('shinsa.code-unified', '${options.unified}'); true`,
      Schema.Unknown
    );
    yield* openPage(page, url);
    yield* waitForSelector(page, rowSelector(anchor.path));
    yield* page.evaluate(`window.__code.watchOpen(${JSON.stringify(anchor.snippet)}, 15000)`, Schema.Unknown);
    yield* Effect.sleep(Duration.seconds(2));
    const split = yield* page.evaluate(`Boolean(document.querySelector('.cm-mergeView'))`, Schema.Boolean);
    const passes = yield* Effect.forEach([0, 1, 2], () => openRows(page, [...rest, anchor], 400));
    return {
      split,
      files: chosen.length,
      first: summarizeOpens(passes[0] ?? []),
      again: summarizeOpens([...(passes[1] ?? []), ...(passes[2] ?? [])]),
    };
  });

  const measureTree = Effect.fn('CodeTab.measureTree')(function* (page: CdpPage) {
    yield* openPage(page, `${options.base}/tasks/${options.task}?tab=code&mode=files`);
    yield* waitForSelector(page, '[role=tree][aria-label=Files] [role=treeitem]');
    yield* Effect.sleep(Duration.seconds(2));
    const expands: Toggled[] = [];
    const collapses: Toggled[] = [];
    const hovered: Toggled[] = [];
    for (const [index, folder] of options.tree.entries()) {
      yield* revealRow(page, rowSelector(folder));
      const at = yield* selectRect(page, rowSelector(folder));
      if (!at) continue;
      const child = `[role=treeitem][aria-label^=${JSON.stringify(`${folder}/`)}]`;
      yield* page.evaluate(
        `window.__expand = window.__code.watchSelector(${JSON.stringify(child)}, true); true`,
        Schema.Unknown
      );
      yield* pressAt(page, at.x, at.y, index % 2 === 0 ? 0 : 400);
      (index % 2 === 0 ? expands : hovered).push(yield* page.evaluate('window.__expand', Toggled));
      yield* Effect.sleep(Duration.millis(300));
      yield* page.evaluate(
        `window.__collapse = window.__code.watchSelector(${JSON.stringify(child)}, false); true`,
        Schema.Unknown
      );
      yield* pressAt(page, at.x, at.y, 0);
      collapses.push(yield* page.evaluate('window.__collapse', Toggled));
      yield* away(page);
      yield* Effect.sleep(Duration.millis(300));
    }
    for (const folder of options.tree.slice(0, 30)) {
      const at = yield* selectRect(page, rowSelector(folder));
      if (at) {
        yield* pressAt(page, at.x, at.y, 0);
        yield* Effect.sleep(Duration.millis(120));
      }
    }
    yield* Effect.sleep(Duration.millis(1500));
    const rows = yield* page.evaluate(
      `(() => { const list = document.querySelector('[role=tree][aria-label=Files] > div'); return list ? Math.round(list.getBoundingClientRect().height / 22) : 0; })()`,
      Schema.Number
    );
    const scroll = yield* page.evaluate(
      `window.__code.frames(async () => {
    const viewport = document.querySelector('[role=tree][aria-label=Files]').closest('[data-slot=scroll-area-viewport]');
    for (let index = 0; index < 120; index += 1) { viewport.scrollTop += 700; await new Promise((r) => requestAnimationFrame(r)); }
    for (let index = 0; index < 120; index += 1) { viewport.scrollTop -= 700; await new Promise((r) => requestAnimationFrame(r)); }
  })`,
      FrameRun
    );
    return {
      expand: summarizeToggles(expands),
      expandHovered: summarizeToggles(hovered),
      collapse: summarizeToggles(collapses),
      rows,
      scroll: {
        frames: scroll.frames,
        p95: scroll.p95,
        max: scroll.max,
        longMax: scroll.long.max,
        longCount: scroll.long.count,
      },
    };
  });

  const measureBigFiles = Effect.fn('CodeTab.measureBigFiles')(function* (page: CdpPage, head: string) {
    const [first, ...rest] = options.files;
    if (!first) return [];
    yield* openPage(
      page,
      `${options.base}/tasks/${options.task}?tab=code&mode=files&file=${encodeURIComponent(first)}`
    );
    yield* Effect.sleep(Duration.seconds(4));
    const results: Record<string, unknown>[] = [];
    let previous = yield* readText(head, first);
    for (const path of rest) {
      const text = yield* readText(head, path);
      const snippet =
        text
          .split('\n')
          .slice(0, 30)
          .map((line) => line.trim().slice(0, 40))
          .find((line) => line.length >= 12 && !previous.includes(line)) ?? '';
      previous = text;
      yield* page.evaluate(
        `window.__watch = window.__code.watchOpen(${JSON.stringify(snippet)}, 20000); window.__code.navigate(${JSON.stringify(
          `/tasks/${options.task}?tab=code&mode=files&file=${encodeURIComponent(path)}`
        )}); true`,
        Schema.Unknown
      );
      const opened = yield* page.evaluate('window.__watch', Opened);
      const scroll = yield* page.evaluate(
        `window.__code.frames(async () => {
      const scroller = document.querySelector('.cm-scroller');
      for (let index = 0; index < 60; index += 1) { scroller.scrollTop += 2000; await new Promise((r) => requestAnimationFrame(r)); }
    })`,
        FrameRun
      );
      results.push({
        path,
        size: text.length,
        ...opened,
        scrollP95: scroll.p95,
        scrollMax: scroll.max,
        scrollLongMax: scroll.long.max,
      });
      yield* Effect.sleep(Duration.seconds(1));
    }
    return results;
  });

  const refs = yield* requestJson(`${options.base}/api/tasks/${options.task}/refs`, Refs);
  const page = yield* chromium.launch({ width: options.width, height: CODE_HEIGHT });
  const result: Record<string, unknown> = {
    label: options.label,
    task: options.task,
    at: DateTime.formatIso(yield* DateTime.now),
  };
  if (options.folder) result.files = yield* measureFiles(page, refs.head);
  if (options.tree.length > 0) result.tree = yield* measureTree(page);
  if (options.files.length > 0) result.big = yield* measureBigFiles(page, refs.head);
  if (options.changes) result.changes = yield* measureChanges(page, refs);
  yield* page.send('HeapProfiler.enable');
  for (let round = 0; round < 3; round += 1) yield* page.send('HeapProfiler.collectGarbage');
  const heap = yield* page.request('Runtime.getHeapUsage', {}, HeapUsage);
  result.heapMb = Math.round((heap.usedSize / MEBIBYTE) * 10) / 10;
  const line = JSON.stringify(result);
  yield* Console.log(line);
  if (options.out) yield* appendReport(options.out, `${line}\n`);
});

program.pipe(Effect.scoped, Effect.provide(ChromiumLayer), BunRuntime.runMain);
