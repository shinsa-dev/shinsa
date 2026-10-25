import { launch } from './content-cdp.ts';
import { PROBE } from './content-probe.ts';

const BASE = Bun.argv[2] ?? 'http://localhost:5665';
const STEPS = (Bun.argv[3] ?? '/tasks/perf-long-chat?tab=chat').split(',');
const TOP = Number(Bun.env.SHINSA_PERF_TOP ?? 30);

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}

interface Profile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

function rankSelfTime(profile: Profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<string, number>();
  profile.samples.forEach((id, index) => {
    const frame = byId.get(id)?.callFrame;
    if (!frame) return;
    const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').at(-1)}:${frame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
}

function rankTotalTime(profile: Profile) {
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
  return [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
}

const browser = await launch();
try {
  const { page } = browser;
  await page.send('Page.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await page.send('Page.navigate', { url: `${BASE}/` });
  await page.evaluate(
    'new Promise((resolve) => { const check = () => window.__perf?.lastState ? resolve(true) : setTimeout(check, 20); check(); })'
  );
  await page.evaluate('window.__perf.sleep(800)');
  await page.send('Profiler.enable');
  await page.send('Profiler.setSamplingInterval', { interval: 100 });
  for (const step of STEPS) {
    if (step === 'warm' || step.startsWith('scroll:')) continue;
    await page.evaluate(`window.__perf.navigate(${JSON.stringify(step)}, 'body')`);
    await page.evaluate('window.__perf.sleep(800)');
  }
  await page.send('Profiler.start');
  for (const step of STEPS) {
    const expression = step.startsWith('scroll:')
      ? `window.__perf.scroll(${JSON.stringify(step.slice(7))}, 'up', 150, 160)`
      : `window.__perf.navigate(${JSON.stringify(step)}, 'body')`;
    const result = await page.evaluate(expression);
    console.info(step, JSON.stringify(result));
    await page.evaluate('window.__perf.sleep(800)');
  }
  const { profile } = await page.send<{ profile: Profile }>('Profiler.stop');
  for (const [name, ms] of rankSelfTime(profile)) console.info(`${ms.toFixed(1).padStart(8)} ms  ${name}`);
  console.info('--- inclusive, capitalised functions (components) ---');
  for (const [name, ms] of rankTotalTime(profile)) console.info(`${ms.toFixed(1).padStart(8)} ms  ${name}`);
} finally {
  browser.close();
}
