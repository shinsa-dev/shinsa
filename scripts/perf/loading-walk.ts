import { BunRuntime } from '@effect/platform-bun';
import { Config, Console, Duration, Effect, Option, Schema } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { type CdpPage, Chromium, ChromiumLayer } from '../kit/chromium/index.ts';
import { openWithProbe } from './browser/probe.ts';
import { ENTER, ESCAPE, HeapUsage, META, PointOrNull, SHIFT } from './browser/schema.ts';
import { LOADING_PROBE } from './loading-probe.ts';
import { listFailures, serializeWaitTable, summarizeWaits } from './loading-stats.ts';
import {
  HOME,
  HOME_DONE,
  LoadingStatesShown,
  ProbedTasks,
  SETTLE_MS,
  TaskDiff,
  TaskRefs,
  WALK_HEIGHT,
  type WaitSample,
  WaitSamples,
} from './loading/schema.ts';
import { writeReport } from './report/write.ts';

const ORIGIN = Bun.argv[2] ?? 'http://127.0.0.1:5720';

const program = Effect.gen(function* () {
  const widths = (yield* Config.String('LOADING_WALK_WIDTHS').pipe(Config.withDefault('1440,900')))
    .split(',')
    .map(Number);
  const taskCount = yield* Config.Number('LOADING_WALK_TASKS').pipe(Config.withDefault(2));
  const out = yield* Config.option(Config.String('LOADING_WALK_OUT'));
  const warmUp = (yield* Config.String('LOADING_WALK_WARM_UP').pipe(Config.withDefault(''))) === '1';
  const chosenHandles = yield* Config.option(Config.String('LOADING_WALK_HANDLES'));
  const chromium = yield* Chromium;
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
  const cold = new Set<string>();

  const waitFor = Effect.fn('LoadingWalk.waitFor')(function* (
    page: CdpPage,
    expression: string,
    timeout: Duration.Input = Duration.seconds(10)
  ) {
    if (yield* page.waitForExpression(expression, timeout)) return true;
    yield* Console.warn(`Timed out waiting for ${expression}`);
    return false;
  });

  const typeText = Effect.fn('LoadingWalk.typeText')(function* (page: CdpPage, text: string) {
    for (const character of text) {
      yield* page.send('Input.insertText', { text: character });
      yield* Effect.sleep(Duration.millis(60));
    }
  });

  const click = Effect.fn('LoadingWalk.click')(function* (page: CdpPage, target: string) {
    const point = yield* page.evaluate(`__loading.center(${JSON.stringify(target)})`, PointOrNull);
    if (!point) return false;
    yield* page.clickPoint(point);
    return true;
  });

  const step = Effect.fn('LoadingWalk.step')(function* <E>(
    page: CdpPage,
    label: string,
    run: Effect.Effect<unknown, E>,
    settleMs = SETTLE_MS
  ) {
    yield* page.evaluate(`__loading.begin(${JSON.stringify(label)})`, Schema.Unknown);
    const ran = yield* run;
    if (ran === false)
      yield* Console.warn(`Skipped ${label} at ${yield* page.evaluate('location.href', Schema.String)}`);
    yield* Effect.sleep(Duration.millis(settleMs));
  });

  const goHome = (page: CdpPage, prefix: string) =>
    step(
      page,
      `${prefix}Home`,
      Effect.flatMap(click(page, HOME), (clicked) =>
        clicked ? waitFor(page, HOME_DONE) : Effect.succeed(false)
      )
    );

  const clickThenWait = (page: CdpPage, target: string, done: string) =>
    Effect.flatMap(click(page, target), (clicked) => (clicked ? waitFor(page, done) : Effect.succeed(false)));

  const pickRef = (page: CdpPage, prefix: string, label: string) =>
    step(
      page,
      `${prefix}Code: ${label}`,
      Effect.gen(function* () {
        const trigger = `__loading.rendered('[aria-label="Show the code at"]')[0]`;
        const options = `__loading.visible('[role=option]').length > 0`;
        if (!(yield* click(page, trigger))) return false;
        if (!(yield* waitFor(page, options, Duration.seconds(2)))) {
          yield* click(page, trigger);
          yield* waitFor(page, options);
        }
        const picked = yield* click(
          page,
          `__loading.visible('[role=option]').find((option) => __loading.textOf(option).startsWith(${JSON.stringify(label)}))`
        );
        if (!picked) yield* page.pressKey(ESCAPE);
        return picked;
      })
    );

  const walkCode = Effect.fn('LoadingWalk.walkCode')(function* (page: CdpPage, prefix: string) {
    const treeItem = (index: number) =>
      `__loading.visible('[role=tree][aria-label="Changed files"] [role=treeitem]:not([aria-expanded])')[${index}]`;
    for (const index of [1, 2, 0])
      yield* step(page, `${prefix}Code: open a changed file`, click(page, treeItem(index)));
    yield* step(page, `${prefix}Code: Files`, click(page, `__loading.tab('Files')`));
    yield* step(
      page,
      `${prefix}Code: open a folder`,
      click(
        page,
        `__loading.visible('[role=tree][aria-label="Files"] [role=treeitem][aria-expanded="false"]')[0]`
      )
    );
    for (const index of [0, 1, 2])
      yield* step(
        page,
        `${prefix}Code: open a file from the tree`,
        click(
          page,
          `__loading.visible('[role=tree][aria-label="Files"] [role=treeitem]:not([aria-expanded])')[${index}]`
        )
      );
    yield* step(page, `${prefix}Code: Changes`, click(page, `__loading.tab('Changes')`));
    yield* step(
      page,
      `${prefix}Code: ⌘P`,
      Effect.andThen(
        page.pressKey({ key: 'p', code: 'KeyP', keyCode: 80, modifiers: META }),
        waitFor(page, `!!document.querySelector('[aria-label="Go to file"]')`)
      )
    );
    yield* step(page, `${prefix}Code: ⌘P query`, typeText(page, 'index'));
    const coldPick = `${prefix}Code: open a file from ⌘P (cold)`;
    cold.add(coldPick);
    yield* step(page, coldPick, page.pressKey(ENTER));
    if (yield* page.evaluate(`!!document.querySelector('[aria-label="Go to file"]')`, Schema.Boolean))
      yield* page.pressKey(ESCAPE);
    for (const label of ['Base', 'Working copy', 'Head of the branch']) yield* pickRef(page, prefix, label);
    yield* step(
      page,
      `${prefix}Code: search`,
      Effect.andThen(
        page.pressKey({ key: 'f', code: 'KeyF', keyCode: 70, modifiers: META | SHIFT }),
        waitFor(page, `document.activeElement?.placeholder === 'Search in files'`)
      )
    );
    const coldSearch = `${prefix}Code: search (cold)`;
    cold.add(coldSearch);
    yield* step(page, coldSearch, typeText(page, 'export'), 1500);
    yield* step(
      page,
      `${prefix}Code: open a match`,
      click(
        page,
        `__loading.visible('[role=tree][aria-label="Search results"] [role=treeitem]:not([aria-expanded])')[0]`
      )
    );
  });

  const walkTask = Effect.fn('LoadingWalk.walkTask')(function* (
    page: CdpPage,
    prefix: string,
    handle: string
  ) {
    yield* step(
      page,
      `${prefix}Home → All tasks`,
      clickThenWait(
        page,
        `[...document.querySelectorAll('header button')].find((button) => button.textContent === 'Tasks')`,
        `location.pathname === '/tasks'`
      )
    );
    yield* step(
      page,
      `${prefix}All tasks → task`,
      Effect.gen(function* () {
        const row = `__loading.rendered('main [role=button]').find((row) => [...row.querySelectorAll('span')].some((part) => __loading.textOf(part) === ${JSON.stringify(handle)}))`;
        if (yield* click(page, row)) return yield* waitFor(page, `location.pathname.startsWith('/tasks/')`);
        yield* page.pressKey({ key: 'k', code: 'KeyK', keyCode: 75, modifiers: META });
        yield* waitFor(page, `!!document.querySelector('[cmdk-input]')`);
        yield* typeText(page, handle);
        yield* Effect.sleep(Duration.millis(300));
        yield* page.pressKey(ENTER);
        return yield* waitFor(page, `location.pathname.startsWith('/tasks/')`);
      })
    );
    for (const tab of ['Overview', 'Review', 'Code', 'Chat']) {
      const present = yield* page.evaluate(`!!__loading.tab(${JSON.stringify(tab)})`, Schema.Boolean);
      if (!present) continue;
      yield* step(
        page,
        `${prefix}Task: ${tab}`,
        clickThenWait(
          page,
          `__loading.tab(${JSON.stringify(tab)})`,
          `__loading.selectedTab(${JSON.stringify(tab)})`
        )
      );
      if (tab === 'Code') yield* walkCode(page, prefix);
    }
    yield* step(page, `${prefix}Task: Overview again`, click(page, `__loading.tab('Overview')`));
  });

  const countChangedFiles = Effect.fn('LoadingWalk.countChangedFiles')(
    function* (handle: string) {
      const task = `${ORIGIN}/api/tasks/${encodeURIComponent(handle)}`;
      const refs = yield* http
        .get(`${task}/refs`)
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(TaskRefs)));
      if (!refs.base) return 0;
      const diff = yield* http
        .get(`${task}/diff?base=${refs.base}&head=${refs.head}`)
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(TaskDiff)));
      return diff.files.length;
    },
    Effect.orElseSucceed(() => 0)
  );

  const pickHandles = Effect.fn('LoadingWalk.pickHandles')(function* (tasks: readonly { handle: string }[]) {
    if (Option.isSome(chosenHandles)) return chosenHandles.value.split(',');
    const picked: string[] = [];
    for (const task of tasks) {
      if (picked.length === taskCount) break;
      if ((yield* countChangedFiles(task.handle)) > 0) picked.push(task.handle);
    }
    const rest = tasks.map((task) => task.handle).filter((handle) => !picked.includes(handle));
    return [...picked, ...rest].slice(0, taskCount);
  });

  const walk = Effect.fn('LoadingWalk.walk')(function* (width: number) {
    const page = yield* chromium.launch({ width, height: WALK_HEIGHT });
    const prefix = `${width}px · `;
    yield* openWithProbe(page, LOADING_PROBE, `${ORIGIN}/`);
    yield* waitFor(page, `window.__loading && ${HOME_DONE}`, Duration.seconds(20));
    yield* Effect.sleep(Duration.millis(1500));
    const handles = yield* pickHandles(yield* page.evaluate('__loading.pickTasks()', ProbedTasks));
    for (const handle of handles) {
      yield* walkTask(page, `${prefix}${handle} · `, handle);
      yield* goHome(page, prefix);
    }
    yield* step(
      page,
      `${prefix}Home → Settings`,
      clickThenWait(
        page,
        `document.querySelector('header button[aria-label="Settings"]')`,
        `location.pathname === '/settings'`
      )
    );
    yield* goHome(page, prefix);
    const samples = yield* page.evaluate('__loading.flush()', WaitSamples);
    for (let pass = 0; pass < 3; pass += 1) yield* page.send('HeapProfiler.collectGarbage');
    const { usedSize } = yield* page.request('Runtime.getHeapUsage', {}, HeapUsage);
    yield* Console.log(`${width}px: JS heap after the walk ${(usedSize / 1024 / 1024).toFixed(1)} MB`);
    return samples;
  }, Effect.scoped);

  const samples: WaitSample[] = (yield* Effect.forEach(widths, walk)).flat();
  const rows = summarizeWaits(samples, cold);
  yield* Console.log(`Loading states seen on ${ORIGIN}\n\n${serializeWaitTable(rows)}`);
  if (Option.isSome(out))
    yield* writeReport(out.value, JSON.stringify({ origin: ORIGIN, rows, samples }, null, 2));
  const failures = listFailures(rows);
  if (warmUp) {
    yield* Console.log(
      `\nWarm-up pass: ${failures.length} loading state(s) showed; this pass does not count.`
    );
    return;
  }
  if (failures.length > 0)
    return yield* new LoadingStatesShown({
      message: `${failures.length} loading state(s) showed in normal use.`,
    });
});

program.pipe(Effect.provide(ChromiumLayer), BunRuntime.runMain);
