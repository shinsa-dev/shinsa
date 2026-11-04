import { BunRuntime } from '@effect/platform-bun';
import { Config, Console, Duration, Effect, Option, Schema } from 'effect';
import { type CdpPage, Chromium, ChromiumLayer } from '../kit/chromium/index.ts';
import { openWithProbe } from './browser/probe.ts';
import { ESCAPE, PointOrNull } from './browser/schema.ts';
import { writeReport } from './report/write.ts';
import { SHELL_PROBE } from './shell-probe.ts';
import { type StepSample, serializeStepTable, summarizeSteps } from './shell-stats.ts';
import {
  HOME_DONE,
  Measured,
  MeasuredOrNull,
  OPEN_SETTLE_MS,
  Settled,
  ShellStepTimedOut,
  type Step,
} from './shell/schema.ts';
import { listNavigationSteps, listTerminalSteps } from './shell/steps.ts';

const ORIGIN = Bun.argv[2] ?? 'http://127.0.0.1:5620';

const program = Effect.gen(function* () {
  const laps = yield* Config.Number('SHELL_PERF_LAPS').pipe(Config.withDefault(6));
  const attach = yield* Config.option(Config.String('SHELL_PERF_ATTACH'));
  const out = yield* Config.option(Config.String('SHELL_PERF_OUT'));
  const hoverMs = yield* Config.Number('SHELL_PERF_HOVER_MS').pipe(Config.withDefault(120));
  const cpu = yield* Config.option(Config.Number('SHELL_PERF_CPU'));
  const settleMs = yield* Config.Number('SHELL_PERF_SETTLE_MS').pipe(Config.withDefault(0));
  const pushesPerPage = yield* Config.Number('SHELL_PERF_PUSHES').pipe(Config.withDefault(3));
  const tabs = (yield* Config.String('SHELL_PERF_TABS').pipe(
    Config.withDefault('Overview,Review,Code,Chat')
  )).split(',');
  const [firstProject = 'Blog', secondProject = 'Shop'] = (yield* Config.String('SHELL_PERF_PROJECTS').pipe(
    Config.withDefault('Blog,Shop')
  )).split(',');
  const onlyTerminal = (yield* Config.String('SHELL_PERF_STEPS').pipe(Config.withDefault(''))) === 'terminal';
  const steps = onlyTerminal ? listTerminalSteps(firstProject, secondProject) : listNavigationSteps(tabs);
  const hover = Duration.millis(hoverMs);
  const chromium = yield* Chromium;

  const waitFor = Effect.fn('ShellNavigation.waitFor')(function* (page: CdpPage, expression: string) {
    if (!(yield* page.waitForExpression(expression)))
      return yield* new ShellStepTimedOut({ message: `Timed out waiting for ${expression}` });
  });

  const openFirst = Effect.fn('ShellNavigation.openFirst')(function* (
    page: CdpPage,
    open: NonNullable<Step['open']>
  ) {
    const point = yield* page.evaluate(`__shell.center(${JSON.stringify(open.target)})`, PointOrNull);
    if (!point) return;
    yield* page.clickPoint(point, hover);
    yield* waitFor(page, open.done);
    yield* Effect.sleep(Duration.millis(OPEN_SETTLE_MS));
  });

  const runStep = Effect.fn('ShellNavigation.runStep')(function* (page: CdpPage, step: Step) {
    if (step.open) yield* openFirst(page, step.open);
    if (step.target) {
      const point = yield* page.evaluate(`__shell.center(${JSON.stringify(step.target)})`, PointOrNull);
      if (!point) return null;
      yield* page.evaluate(`__shell.arm(${JSON.stringify(step.done)}, 'click')`, Schema.Unknown);
      yield* page.clickPoint(point, hover);
    } else if (step.key) {
      yield* page.evaluate(`__shell.arm(${JSON.stringify(step.done)}, 'keydown')`, Schema.Unknown);
      yield* page.pressKey(step.key);
    }
    return yield* page.evaluate('__shell.step', MeasuredOrNull);
  });

  const closeMenu = Effect.fn('ShellNavigation.closeMenu')(function* (page: CdpPage) {
    yield* page.pressKey({ ...ESCAPE, modifiers: 0 });
    yield* waitFor(page, `!document.querySelector('[cmdk-input]')`);
  });

  const closeOpenMenu = Effect.fn('ShellNavigation.closeOpenMenu')(function* (page: CdpPage) {
    yield* page.evaluate(
      `document.querySelector('[role=menu][data-open]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      Schema.Unknown
    );
    yield* waitFor(page, `!document.querySelector('[role=menu][data-open]')`);
  });

  const page = yield* chromium.open(Option.getOrNull(attach), ORIGIN);
  yield* page.send('Page.enable');
  if (Option.isSome(cpu)) yield* page.send('Emulation.setCPUThrottlingRate', { rate: cpu.value });
  yield* openWithProbe(page, SHELL_PROBE, `${ORIGIN}/`);
  yield* waitFor(page, `window.__shell && ${HOME_DONE}`);
  yield* page.evaluate('__shell.idle(1500)', Schema.Unknown);

  const settles: { label: string; settledAt: number; maxGap: number }[] = [];
  const cold: StepSample[] = [];
  const warm: StepSample[] = [];
  const pushes: StepSample[] = [];

  const lapStep = Effect.fn('ShellNavigation.lapStep')(function* (step: Step, lap: number) {
    const measured = yield* runStep(page, step);
    if (measured) (lap === 0 ? cold : warm).push({ label: step.label, ...measured });
    else yield* Console.warn(`Skipped ${step.label} on lap ${lap + 1}`);
    if (measured && settleMs > 0)
      settles.push({
        label: `${step.label}${lap === 0 ? ' (first)' : ''}`,
        ...(yield* page.evaluate(`__shell.settle(${settleMs})`, Settled)),
      });
    if (step.key) yield* closeMenu(page);
    if (step.open) yield* closeOpenMenu(page);
    yield* page.evaluate('__shell.idle(250)', Schema.Unknown);
    for (let push = 0; measured && step.pushes && push < pushesPerPage; push += 1) {
      pushes.push({ label: step.pushes, ...(yield* page.evaluate('__shell.push()', Measured)) });
      yield* page.evaluate('__shell.idle(100)', Schema.Unknown);
    }
  });

  const printSettled = Effect.fn('ShellNavigation.printSettled')(function* () {
    const labels = [...new Set(settles.map((each) => each.label))];
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    yield* Console.log('\nSettled (click to the last frame longer than 34 ms, and the longest frame)\n');
    for (const label of labels) {
      const mine = settles.filter((each) => each.label === label);
      yield* Console.log(
        `| ${label} | ${median(mine.map((each) => each.settledAt)).toFixed(1)} ms | ${median(mine.map((each) => each.maxGap)).toFixed(1)} ms |`
      );
    }
  });

  for (let lap = 0; lap < laps; lap += 1) for (const step of steps) yield* lapStep(step, lap);

  const report = {
    origin: ORIGIN,
    laps,
    cold: summarizeSteps(cold),
    warm: summarizeSteps(warm),
    pushes: summarizeSteps(pushes),
  };
  yield* Console.log(`First visit (lap 1), ${ORIGIN}\n\n${serializeStepTable(report.cold)}\n`);
  yield* Console.log(`Revisits (laps 2–${laps})\n\n${serializeStepTable(report.warm)}\n`);
  yield* Console.log(
    `State pushes (one task's priority changes; push to paint)\n\n${serializeStepTable(report.pushes)}`
  );
  if (settleMs > 0) yield* printSettled();
  if (Option.isSome(out))
    yield* writeReport(out.value, JSON.stringify({ ...report, samples: { cold, warm, pushes } }, null, 2));
});

program.pipe(Effect.scoped, Effect.provide(ChromiumLayer), BunRuntime.runMain);
