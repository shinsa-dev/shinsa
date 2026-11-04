import { BunRuntime } from '@effect/platform-bun';
import { Clock, Config, Console, Duration, Effect, Fiber, Option, Schema } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { type CdpPage, Chromium, ChromiumLayer } from '../kit/chromium/index.ts';
import { HeapUsage, PointOrNull } from './browser/schema.ts';
import { writeReport } from './report/write.ts';
import { serializeSoakRow, serializeSoakTable } from './soak-stats.ts';
import {
  Frames,
  HOME_DONE,
  NoSoakTask,
  PerformanceMetrics,
  SOAK_PROBE,
  type SoakSample,
  TaskRows,
  TRANSITIONS,
} from './soak/schema.ts';

const ORIGIN = Bun.argv[2] ?? 'http://127.0.0.1:5640';

const program = Effect.gen(function* () {
  const laps = yield* Config.Number('SOAK_LAPS').pipe(Config.withDefault(30));
  const sampleEvery = yield* Config.Number('SOAK_SAMPLE_EVERY').pipe(Config.withDefault(10));
  const taskCount = yield* Config.Number('SOAK_TASKS').pipe(Config.withDefault(8));
  const idleMs = yield* Config.Number('SOAK_IDLE_MS').pipe(Config.withDefault(5000));
  const pushes = yield* Config.Number('SOAK_PUSHES').pipe(Config.withDefault(20));
  const files = yield* Config.Number('SOAK_FILES').pipe(Config.withDefault(4));
  const attach = yield* Config.option(Config.String('SOAK_ATTACH'));
  const out = yield* Config.option(Config.String('SOAK_OUT'));
  const chosenTask = yield* Config.option(Config.String('SOAK_TASK'));
  const chromium = yield* Chromium;
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);

  const readMetrics = Effect.fn('Soak.readMetrics')(function* (page: CdpPage) {
    const { metrics } = yield* page.request('Performance.getMetrics', {}, PerformanceMetrics);
    const byName = new Map(metrics.map((metric) => [metric.name, metric.value]));
    return {
      taskDuration: byName.get('TaskDuration') ?? 0,
      scriptDuration: byName.get('ScriptDuration') ?? 0,
      recalcStyleCount: byName.get('RecalcStyleCount') ?? 0,
      layoutCount: byName.get('LayoutCount') ?? 0,
    };
  });

  const readHeapMb = Effect.fn('Soak.readHeapMb')(function* (page: CdpPage) {
    yield* page.send('HeapProfiler.collectGarbage');
    const heap = yield* page.request('Runtime.getHeapUsage', {}, HeapUsage);
    return heap.usedSize / 1_000_000;
  });

  const visitTab = Effect.fn('Soak.visitTab')(function* (page: CdpPage, name: string) {
    if (!(yield* page.waitForExpression(`__soak.tab(${JSON.stringify(name)})`, Duration.seconds(3))))
      return false;
    yield* page.evaluate(`__soak.tab(${JSON.stringify(name)}).click()`, Schema.Unknown);
    return yield* page.waitForExpression(`__soak.selectedTab(${JSON.stringify(name)})`, Duration.seconds(5));
  });

  const visitTask = Effect.fn('Soak.visitTask')(function* (page: CdpPage, handle: string) {
    yield* page.evaluate(`__soak.go('/tasks/${handle}')`, Schema.Unknown);
    const opened = yield* page.waitForExpression(
      `location.pathname === '/tasks/${handle}' && !!document.querySelector('[role=tab]')`
    );
    if (!opened) return;
    if (yield* visitTab(page, 'Chat')) yield* page.evaluate('__soak.scrollUp(6)', Schema.Unknown);
    if (yield* visitTab(page, 'Code')) {
      yield* page.waitForExpression(`!!document.querySelector('[role=treeitem]')`, Duration.seconds(5));
      yield* page.evaluate(`__soak.openFiles(${files})`, Schema.Unknown);
    }
    if (yield* visitTab(page, 'Review')) yield* Effect.sleep(Duration.millis(200));
    yield* visitTab(page, 'Overview');
    yield* Effect.sleep(Duration.millis(200));
  });

  const measureTransition = Effect.fn('Soak.measureTransition')(function* (
    page: CdpPage,
    handle: string,
    from: string,
    to: string
  ) {
    yield* page.evaluate(`__soak.go('/tasks/${handle}')`, Schema.Unknown);
    yield* visitTab(page, from);
    yield* Effect.sleep(Duration.millis(600));
    const point = yield* page.evaluate(`__soak.center(__soak.tab('${to}'))`, PointOrNull);
    if (!point) return Option.none<Frames>();
    yield* page.evaluate(`__soak.done = () => __soak.selectedTab('${to}')`, Schema.Unknown);
    const frames = yield* Effect.forkChild(page.evaluate('__soak.frames(1200)', Frames));
    yield* Effect.sleep(Duration.millis(50));
    yield* page.clickPoint(point);
    return Option.some(yield* Fiber.join(frames));
  });

  const measure = Effect.fn('Soak.measure')(function* (
    page: CdpPage,
    lap: number,
    startedAt: number,
    pinned: string
  ) {
    yield* page.evaluate(`__soak.go('/tasks/${pinned}')`, Schema.Unknown);
    yield* visitTab(page, 'Chat');
    yield* Effect.sleep(Duration.seconds(1));
    const nodes = yield* page.evaluate(`document.getElementsByTagName('*').length`, Schema.Number);
    const heapMb = yield* readHeapMb(page);
    const before = yield* readMetrics(page);
    const [idle, after] = yield* Effect.timed(
      Effect.andThen(Effect.sleep(Duration.millis(idleMs)), readMetrics(page))
    );
    const seconds = Duration.toMillis(idle) / 1000;
    const transition: Frames[] = [];
    for (const [from, to] of TRANSITIONS) {
      const frames = yield* measureTransition(page, pinned, from, to);
      if (Option.isSome(frames)) transition.push(frames.value);
    }
    const sample: SoakSample = {
      lap,
      minutes: ((yield* Clock.currentTimeMillis) - startedAt) / 60_000,
      nodes,
      heapMb,
      idleBusy: (after.taskDuration - before.taskDuration) / seconds,
      scriptBusy: (after.scriptDuration - before.scriptDuration) / seconds,
      recalcsPerSecond: (after.recalcStyleCount - before.recalcStyleCount) / seconds,
      layoutsPerSecond: (after.layoutCount - before.layoutCount) / seconds,
      transition,
    };
    return sample;
  });

  const { tasks } = yield* http
    .get(`${ORIGIN}/api/tasks`)
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(TaskRows)));
  const handles = tasks
    .filter((task) => task.stage !== 'done' && task.stage !== 'cancelled')
    .concat(tasks)
    .map((task) => task.handle)
    .filter((handle, index, all) => all.indexOf(handle) === index)
    .slice(0, taskCount);
  const pinned = Option.getOrElse(chosenTask, () => handles[0]);
  if (!pinned) return yield* new NoSoakTask({ message: `No tasks on ${ORIGIN}.` });

  const page = yield* chromium.open(Option.getOrNull(attach), ORIGIN);
  yield* page.send('Page.enable');
  yield* page.send('Performance.enable');
  yield* page.send('Page.addScriptToEvaluateOnNewDocument', { source: SOAK_PROBE });
  if (Option.isSome(attach)) yield* page.evaluate(SOAK_PROBE, Schema.Unknown);
  else yield* page.send('Page.navigate', { url: `${ORIGIN}/` });
  yield* page.waitForExpression(`window.__soak && ${HOME_DONE}`, Duration.seconds(30));
  yield* Effect.sleep(Duration.millis(1500));

  const startedAt = yield* Clock.currentTimeMillis;
  const samples: SoakSample[] = [yield* measure(page, 0, startedAt, pinned)];
  for (let lap = 1; lap <= laps; lap += 1) {
    for (const handle of handles) {
      yield* visitTask(page, handle);
      for (let push = 0; push < pushes / handles.length; push += 1) {
        yield* page.evaluate('__soak.push()', Schema.Unknown);
        yield* Effect.sleep(Duration.millis(40));
      }
    }
    yield* page.evaluate(`__soak.go('/tasks')`, Schema.Unknown);
    yield* Effect.sleep(Duration.millis(300));
    yield* page.evaluate(`__soak.go('/')`, Schema.Unknown);
    yield* page.waitForExpression(HOME_DONE);
    if (lap % sampleEvery === 0 || lap === laps) {
      const sample = yield* measure(page, lap, startedAt, pinned);
      samples.push(sample);
      yield* Console.log(serializeSoakRow(sample));
    }
  }

  yield* Console.log(
    `\nSoak on ${ORIGIN}: ${laps} laps over ${handles.join(', ')}; idle and transitions on ${pinned}'s Chat\n`
  );
  yield* Console.log(serializeSoakTable(samples));
  if (Option.isSome(out))
    yield* writeReport(
      out.value,
      JSON.stringify({ origin: ORIGIN, laps, handles, pinned, samples }, null, 2)
    );
});

program.pipe(Effect.scoped, Effect.provide(ChromiumLayer), BunRuntime.runMain);
