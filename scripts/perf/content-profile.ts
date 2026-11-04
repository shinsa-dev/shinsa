import { BunRuntime } from '@effect/platform-bun';
import { Config, Console, Effect, Schema } from 'effect';
import { ChromiumLayer } from '../kit/chromium/index.ts';
import { openContentPage, resolveStepExpression } from './content/page.ts';
import { type Profile, ProfileReply, SCROLL_STEP } from './content/schema.ts';

const BASE = Bun.argv[2] ?? 'http://localhost:5665';
const STEPS = (Bun.argv[3] ?? '/tasks/perf-long-chat?tab=chat').split(',');

function rankSelfTime(profile: Profile, top: number) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<string, number>();
  profile.samples.forEach((id, index) => {
    const frame = byId.get(id)?.callFrame;
    if (!frame) return;
    const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').at(-1)}:${frame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

function rankTotalTime(profile: Profile, top: number) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const total = new Map<string, number>();
  profile.samples.forEach((id, index) => {
    const seen = new Set<string>();
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const frame = byId.get(at)?.callFrame;
      if (!frame?.functionName || !/^[A-Z]/.test(frame.functionName)) continue;
      if (seen.has(frame.functionName)) continue;
      seen.add(frame.functionName);
      total.set(
        frame.functionName,
        (total.get(frame.functionName) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000
      );
    }
  });
  return [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

const program = Effect.gen(function* () {
  const top = yield* Config.Number('SHINSA_PERF_TOP').pipe(Config.withDefault(30));
  const page = yield* openContentPage(BASE);
  const pause = page.evaluate('window.__perf.sleep(800)', Schema.Unknown);
  yield* pause;
  yield* page.send('Profiler.enable');
  yield* page.send('Profiler.setSamplingInterval', { interval: 100 });
  for (const step of STEPS) {
    if (step === 'warm' || step.startsWith(SCROLL_STEP)) continue;
    yield* page.evaluate(`window.__perf.navigate(${JSON.stringify(step)}, 'body')`, Schema.Unknown);
    yield* pause;
  }
  yield* page.send('Profiler.start');
  for (const step of STEPS) {
    const result = yield* page.evaluate(resolveStepExpression(step), Schema.Unknown);
    yield* Console.info(step, JSON.stringify(result));
    yield* pause;
  }
  const { profile } = yield* page.request('Profiler.stop', {}, ProfileReply);
  for (const [name, ms] of rankSelfTime(profile, top))
    yield* Console.info(`${ms.toFixed(1).padStart(8)} ms  ${name}`);
  yield* Console.info('--- inclusive, capitalised functions (components) ---');
  for (const [name, ms] of rankTotalTime(profile, top))
    yield* Console.info(`${ms.toFixed(1).padStart(8)} ms  ${name}`);
});

program.pipe(Effect.scoped, Effect.provide(ChromiumLayer), BunRuntime.runMain);
