import { BunRuntime } from '@effect/platform-bun';
import { Config, Console, Duration, Effect, Option, Schema } from 'effect';
import { type CdpPage, ChromiumLayer } from '../kit/chromium/index.ts';
import { summarize, summarizeBlankScroll, summarizeReveal, summarizeRowPushes } from './content-stats.ts';
import { openContentPage } from './content/page.ts';
import {
  BlankRecording,
  BlankTarget,
  ChatScroll,
  HeldPlace,
  Inputs,
  ListScroll,
  LongTasks,
  type Measurements,
  Navigation,
  NO_MEASUREMENTS,
  PushCost,
  RevealCounts,
  RowPushes,
  RUN_SECTION,
  type Scenario,
  TASK_ROW,
  HARD_FLICK,
  WHEEL_FLICK,
} from './content/schema.ts';
import { writeReport } from './report/write.ts';

const BASE = Bun.argv[2] ?? 'http://localhost:5661';

const program = Effect.gen(function* () {
  const rounds = yield* Config.Number('SHINSA_PERF_ROUNDS').pipe(Config.withDefault(3));
  const only = yield* Config.option(Config.String('SHINSA_PERF_ONLY'));
  const chosenTask = yield* Config.option(Config.String('SHINSA_PERF_TASK'));
  const out = yield* Config.option(Config.String('SHINSA_PERF_OUT'));
  const cpuSlowdown = yield* Config.Number('SHINSA_PERF_CPU').pipe(Config.withDefault(1));

  const navigate = (page: CdpPage, path: string, ready = 'body') =>
    page.evaluate(`window.__perf.navigate(${JSON.stringify(path)}, ${JSON.stringify(ready)})`, Navigation);

  const settle = (page: CdpPage) => page.evaluate('window.__perf.sleep(600)', Schema.Unknown);

  const pickTask = (page: CdpPage) =>
    Option.isSome(chosenTask)
      ? Effect.succeed(chosenTask.value)
      : page.evaluate(
          `(() => {
    const state = JSON.parse(window.__perf.lastState).state;
    const counts = {};
    for (const run of Object.values(state.runs)) counts[run.taskId] = (counts[run.taskId] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  })()`,
          Schema.String
        );

  const selectLiveRun = (page: CdpPage, taskId: string) =>
    page.evaluate(
      `(() => {
    const state = JSON.parse(window.__perf.lastState).state;
    const runs = Object.values(state.runs).filter((run) => run.taskId === ${JSON.stringify(taskId)});
    return (runs.find((run) => run.endedAt === null) ?? runs.at(-1))?.id ?? null;
  })()`,
      Schema.NullOr(Schema.String)
    );

  const typeText = Effect.fn('ContentMeasure.typeText')(function* (page: CdpPage, text: string) {
    for (const char of text) {
      yield* page.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        key: char,
        unmodifiedText: char,
      });
      yield* page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
      yield* Effect.sleep(Duration.millis(45));
    }
  });

  const openChat = Effect.fn('ContentMeasure.openChat')(function* (page: CdpPage, taskId: string) {
    yield* navigate(page, '/');
    yield* settle(page);
    const open = yield* navigate(page, `/tasks/${taskId}?tab=chat`, RUN_SECTION);
    const [settledFor] = yield* Effect.timed(settle(page));
    const settled = yield* page.evaluate(
      `window.__perf.since(performance.now() - ${Duration.toMillis(settledFor) + 600})`,
      LongTasks
    );
    return {
      paintMs: open.ms,
      paintLongMax: open.long.max,
      settleLongMax: settled.max,
      settleLongTotal: settled.total,
    };
  });

  const switchTabs = Effect.fn('ContentMeasure.switchTabs')(function* (page: CdpPage, taskId: string) {
    yield* navigate(page, `/tasks/${taskId}?tab=chat`, RUN_SECTION);
    yield* settle(page);
    for (const tab of ['overview', 'review', 'chat']) {
      yield* navigate(page, `/tasks/${taskId}?tab=${tab}`);
      yield* settle(page);
    }
    const overview = yield* navigate(page, `/tasks/${taskId}?tab=overview`);
    yield* settle(page);
    const review = yield* navigate(page, `/tasks/${taskId}?tab=review`);
    yield* settle(page);
    const chat = yield* navigate(page, `/tasks/${taskId}?tab=chat`, RUN_SECTION);
    yield* settle(page);
    return { toOverviewMs: overview.ms, toReviewMs: review.ms, toChatMs: chat.ms };
  });

  const scrollChat = Effect.fn('ContentMeasure.scrollChat')(function* (page: CdpPage, taskId: string) {
    yield* navigate(page, `/tasks/${taskId}?tab=chat`, RUN_SECTION);
    yield* settle(page);
    const result = yield* page.evaluate(
      `window.__perf.scroll(${JSON.stringify(RUN_SECTION)}, 'up', 150, 160)`,
      ChatScroll
    );
    if (!result) return NO_MEASUREMENTS;
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
  });

  const holdPlace = Effect.fn('ContentMeasure.holdPlace')(function* (page: CdpPage, taskId: string) {
    yield* navigate(page, `/tasks/${taskId}?tab=chat`, RUN_SECTION);
    yield* settle(page);
    const result = yield* page.evaluate(
      `window.__perf.holdPlace(${JSON.stringify(RUN_SECTION)}, 300, 160)`,
      HeldPlace
    );
    if (!result) return NO_MEASUREMENTS;
    return { placeJumps: result.jumps, placeWorstPx: Math.round(result.worst) };
  });

  const typeWhileStreaming = Effect.fn('ContentMeasure.typeWhileStreaming')(function* (
    page: CdpPage,
    taskId: string
  ) {
    yield* navigate(page, `/tasks/${taskId}?tab=chat`, RUN_SECTION);
    yield* settle(page);
    const runId = yield* selectLiveRun(page, taskId);
    const focused = yield* page.evaluate(
      `(() => { const box = [...document.querySelectorAll('textarea')].find((each) => each.offsetParent !== null); if (!box) return false; box.focus(); return true; })()`,
      Schema.Boolean
    );
    if (!focused || !runId) return NO_MEASUREMENTS;
    const start = yield* page.evaluate('performance.now()', Schema.Number);
    yield* page.evaluate(`window.__perf.startStream(${JSON.stringify(runId)}, 20, 1)`, Schema.Unknown);
    yield* typeText(page, 'the header should wrap on narrow windows ');
    yield* page.evaluate('window.__perf.stopStream()', Schema.Unknown);
    const inputs = yield* page.evaluate(`window.__perf.inputsSince(${start})`, Inputs);
    const long = yield* page.evaluate(`window.__perf.since(${start})`, LongTasks);
    const streamed = yield* page.evaluate(
      `document.body.innerText.includes('Streaming update')`,
      Schema.Boolean
    );
    return {
      streamed: streamed ? 1 : 0,
      inputPaintMax: Math.max(0, ...inputs.map((input) => input.paint)),
      inputOver16: inputs.filter((input) => input.paint > 16.7).length,
      longMax: long.max,
      longCount: long.count,
    };
  });

  const pushes = Effect.fn('ContentMeasure.pushes')(function* (page: CdpPage, taskId: string) {
    yield* navigate(page, `/tasks/${taskId}?tab=chat`, RUN_SECTION);
    yield* settle(page);
    const runId = yield* selectLiveRun(page, taskId);
    const cost = yield* page.evaluate(`window.__perf.pushCost(${JSON.stringify(runId)}, 15)`, PushCost);
    return {
      stateMs: cost.state,
      stateMaxMs: cost.stateMax,
      transcriptMs: cost.transcript,
      transcriptMaxMs: cost.transcriptMax,
    };
  });

  const lists = Effect.fn('ContentMeasure.lists')(function* (page: CdpPage) {
    yield* navigate(page, '/');
    yield* settle(page);
    const tasks = yield* navigate(page, '/tasks', TASK_ROW);
    yield* settle(page);
    const scroll = yield* page.evaluate(
      `window.__perf.scroll(${JSON.stringify(TASK_ROW)}, 'down', 120, 120)`,
      ListScroll
    );
    const home = yield* navigate(page, '/', 'a[href^="/tasks/"]');
    yield* settle(page);
    return {
      tasksPaintMs: tasks.ms,
      tasksLongMax: tasks.long.max,
      tasksScrollMax: scroll?.max ?? 0,
      tasksScrollLongMax: scroll?.long.max ?? 0,
      homePaintMs: home.ms,
      homeLongMax: home.long.max,
    };
  });

  const openTasks = Effect.fn('ContentMeasure.openTasks')(function* (page: CdpPage) {
    yield* navigate(page, '/');
    yield* settle(page);
    const tasks = yield* navigate(page, '/tasks', TASK_ROW);
    yield* settle(page);
    return tasks;
  });

  const wheelFlick = Effect.fn('ContentMeasure.wheelFlick')(function* (
    page: CdpPage,
    withPushes: boolean,
    flick: typeof WHEEL_FLICK = WHEEL_FLICK
  ) {
    yield* openTasks(page);
    const target = yield* page.evaluate(
      `window.__perf.recordBlank(${JSON.stringify(TASK_ROW)})`,
      BlankTarget
    );
    if (!target) return NO_MEASUREMENTS;
    if (withPushes) yield* page.evaluate(`window.__perf.startPushes(${flick.pushEveryMs})`, Schema.Unknown);
    for (let index = 0; index < flick.events; index += 1) {
      yield* page.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: target.x,
        y: target.y,
        deltaX: 0,
        deltaY: flick.deltaY,
      });
      yield* Effect.sleep(Duration.millis(flick.everyMs));
    }
    yield* Effect.sleep(Duration.millis(300));
    const recording = yield* page.evaluate('window.__perf.stopBlank()', BlankRecording);
    return {
      ...summarizeBlankScroll(recording.blank, recording.deltas, target.viewport),
      distancePx: recording.distance,
      longMax: recording.long.max,
      longCount: recording.long.count,
    };
  });

  const revealTasks = Effect.fn('ContentMeasure.revealTasks')(function* (page: CdpPage) {
    yield* openTasks(page);
    yield* navigate(page, '/');
    yield* settle(page);
    const counts = yield* page.evaluate(
      `window.__perf.revealRows('/tasks', ${JSON.stringify(TASK_ROW)}, 30)`,
      RevealCounts
    );
    return summarizeReveal(counts);
  });

  const taskPushes = Effect.fn('ContentMeasure.taskPushes')(function* (page: CdpPage) {
    yield* openTasks(page);
    const result = yield* page.evaluate('window.__perf.rowPushes(10)', RowPushes);
    return summarizeRowPushes(result.pushes, result.visibleRows);
  });

  const scenarios: ReadonlyArray<readonly [string, Scenario]> = [
    ['openChat', openChat],
    ['switchTabs', switchTabs],
    ['scrollChat', scrollChat],
    ['holdPlace', holdPlace],
    ['typeWhileStreaming', typeWhileStreaming],
    ['pushes', pushes],
    ['lists', lists],
    ['wheelTasks', (page) => wheelFlick(page, false)],
    ['wheelTasksWhilePushed', (page) => wheelFlick(page, true)],
    ['hardFlickTasks', (page) => wheelFlick(page, false, HARD_FLICK)],
    ['revealTasks', revealTasks],
    ['taskPushes', taskPushes],
  ];

  const runRound = Effect.fn('ContentMeasure.runRound')(function* (scenario: Scenario) {
    const page = yield* openContentPage(BASE);
    if (cpuSlowdown > 1) yield* page.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
    yield* settle(page);
    return yield* scenario(page, yield* pickTask(page));
  }, Effect.scoped);

  const chosen = Option.match(only, {
    onNone: () => scenarios,
    onSome: (names) => scenarios.filter(([name]) => names.split(',').includes(name)),
  });
  const results: Record<string, Measurements> = {};
  for (const [name, scenario] of chosen) {
    const samples = yield* Effect.forEach(Array.from({ length: rounds }), () => runRound(scenario));
    results[name] = summarize(samples);
    yield* Console.info(name, JSON.stringify(results[name]));
  }
  if (Option.isSome(out)) yield* writeReport(out.value, `${JSON.stringify(results, null, 2)}\n`);
});

program.pipe(Effect.provide(ChromiumLayer), BunRuntime.runMain);
