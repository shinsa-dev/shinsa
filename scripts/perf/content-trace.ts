import { BunRuntime } from '@effect/platform-bun';
import { Config, Console, Effect, Option, Schema, Stream } from 'effect';
import { ChromiumLayer } from '../kit/chromium/index.ts';
import { openContentPage, resolveStepExpression } from './content/page.ts';
import { MAIN_EVENTS, SCROLL_STEP, TraceChunk } from './content/schema.ts';

const BASE = Bun.argv[2] ?? 'http://localhost:5661';
const STEPS = (Bun.argv[3] ?? '/tasks/perf-long-chat?tab=overview,/tasks/perf-long-chat?tab=chat').split(',');

const program = Effect.gen(function* () {
  const css = yield* Config.option(Config.String('SHINSA_PERF_CSS'));
  const decodeChunk = Schema.decodeUnknownEffect(TraceChunk);
  const page = yield* openContentPage(BASE);
  yield* page.evaluate('window.__perf.sleep(800)', Schema.Unknown);
  for (const step of STEPS) {
    if (step.startsWith(SCROLL_STEP)) continue;
    yield* page.evaluate(`window.__perf.navigate(${JSON.stringify(step)}, 'body')`, Schema.Unknown);
    yield* page.evaluate('window.__perf.sleep(600)', Schema.Unknown);
  }
  if (Option.isSome(css))
    yield* page.evaluate(
      `(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(css.value)}; document.head.append(style); })()`,
      Schema.Unknown
    );
  for (const step of STEPS) {
    yield* page.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
      transferMode: 'ReportEvents',
    });
    const result = yield* page.evaluate(resolveStepExpression(step), Schema.Unknown);
    yield* page.evaluate('window.__perf.sleep(300)', Schema.Unknown);
    const events = yield* Effect.scoped(
      Effect.gen(function* () {
        const traced = yield* page.subscribe('Tracing.dataCollected', 'Tracing.tracingComplete');
        yield* page.send('Tracing.end');
        return yield* traced.pipe(
          Stream.takeWhile((event) => event.method !== 'Tracing.tracingComplete'),
          Stream.mapEffect((event) => decodeChunk(event.params)),
          Stream.runCollect
        );
      })
    );
    const totals = new Map<string, number>();
    for (const event of events.flatMap((chunk) => chunk.value)) {
      if (event.ph !== 'X' || !MAIN_EVENTS.has(event.name)) continue;
      totals.set(event.name, (totals.get(event.name) ?? 0) + (event.dur ?? 0) / 1000);
    }
    const summary = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, ms]) => `${name} ${ms.toFixed(1)}`)
      .join(', ');
    yield* Console.info(step, JSON.stringify(result), '\n   ', summary);
  }
});

program.pipe(Effect.scoped, Effect.provide(ChromiumLayer), BunRuntime.runMain);
