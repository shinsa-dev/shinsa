import { writeFileSync } from 'node:fs';
import { launchChrome, listTargets, ShellPage } from './shell-cdp.ts';
import { SHELL_PROBE } from './shell-probe.ts';
import { type StepSample, serializeStepTable, summarizeSteps } from './shell-stats.ts';

interface Step {
  label: string;
  open?: { target: string; done: string };
  pushes?: string;
  target?: string;
  key?: { key: string; code: string; keyCode: number; modifiers: number };
  done: string;
}

interface Measured {
  clickToPaint: number;
  commits: number;
  rendered: number;
  longTasks: number;
  longTaskTotal: number;
}

const ORIGIN = Bun.argv[2] ?? 'http://127.0.0.1:5620';
const LAPS = Number(Bun.env.SHELL_PERF_LAPS ?? 6);
const ATTACH = Bun.env.SHELL_PERF_ATTACH ?? null;
const OUT = Bun.env.SHELL_PERF_OUT ?? null;
const HOVER_MS = Number(Bun.env.SHELL_PERF_HOVER_MS ?? 120);
const META = 4;
const OPEN_SETTLE_MS = 400;

const HOME = `document.querySelector('header [aria-label="Home"]') || __shell.byPrefix('header button', '^Shinsa') || __shell.byText('nav [data-highlight-item]', 'New task')`;
const HOME_DONE = `location.pathname === '/' && !!document.querySelector('main textarea')`;
const TASK_ROW = String.raw`__shell.byPrefix('main button', '[A-Z]+-\\d+ ·')`;

function tabStep(from: string, to: string, extra = 'true'): Step {
  return {
    label: `${from} → ${to}`,
    target: `__shell.tab('${to}')`,
    done: `__shell.selectedTab('${to}') && (${extra})`,
  };
}

const TABS = (Bun.env.SHELL_PERF_TABS ?? 'Overview,Review,Code,Chat').split(',');
const TAB_READY: Record<string, string> = { Code: `!!document.querySelector('.cm-content')` };

function listTabSteps() {
  const loop = [...TABS, TABS[0] ?? 'Overview'];
  return loop.slice(1).map((to, index) => tabStep(loop[index] ?? 'Overview', to, TAB_READY[to]));
}

const TERMINAL_DONE = `location.pathname === '/terminal' && __shell.terminals > 0 && __shell.terminalsWaiting === 0 && [...document.querySelectorAll('.xterm')].some((terminal) => terminal.offsetParent && terminal.querySelector('.xterm-screen canvas'))`;

const TERMINAL_TAB = (index: number) =>
  `[...document.querySelectorAll('[aria-label="Terminals"] [role=tab]')].filter((tab) => tab.offsetParent)[${index}]`;

const TERMINAL_SHOWN = `[...document.querySelectorAll('.xterm')].some((terminal) => terminal.offsetParent && terminal.querySelector('.xterm-screen canvas'))`;

function terminalTabStep(from: number, to: number): Step {
  return {
    label: `Terminal tab ${from + 1} → ${to + 1}`,
    target: TERMINAL_TAB(to),
    done: `${TERMINAL_TAB(to)}?.getAttribute('aria-selected') === 'true' && ${TERMINAL_SHOWN}`,
  };
}

const PROJECT_PICKER = `[...document.querySelectorAll('main button[aria-haspopup=menu]')].find((button) => button.offsetParent)`;

const [FIRST_PROJECT = 'Blog', SECOND_PROJECT = 'Shop'] = (Bun.env.SHELL_PERF_PROJECTS ?? 'Blog,Shop').split(
  ','
);

function terminalProjectStep(from: string, to: string): Step {
  return {
    label: `Terminal ${from} → ${to}`,
    open: {
      target: PROJECT_PICKER,
      done: `!!__shell.byText('[role=menuitemradio]', '${to}')`,
    },
    target: `__shell.byText('[role=menuitemradio]', '${to}')`,
    done: `${PROJECT_PICKER}?.textContent === '${to}' && ${TERMINAL_SHOWN}`,
  };
}

const TERMINAL_STEPS: Step[] = [
  {
    label: 'Home → Terminal',
    open: {
      target: `document.querySelector('header [data-services-trigger]')`,
      done: `!!document.querySelector('[data-terminal-entry]')`,
    },
    target: `document.querySelector('[data-terminal-entry]') || document.querySelector('header button[aria-label="Terminal"]')`,
    done: TERMINAL_DONE,
  },
  terminalProjectStep(FIRST_PROJECT, SECOND_PROJECT),
  terminalTabStep(0, 1),
  terminalTabStep(1, 2),
  terminalTabStep(2, 0),
  terminalProjectStep(SECOND_PROJECT, FIRST_PROJECT),
  { label: 'Terminal → Home', target: HOME, done: HOME_DONE },
];

const NAVIGATION_STEPS: Step[] = [
  {
    label: 'Home → task',
    pushes: 'State push on a task',
    target: TASK_ROW,
    done: `location.pathname.startsWith('/tasks/') && __shell.selectedTab('Overview')`,
  },
  ...listTabSteps(),
  { label: 'Task → Home', target: HOME, done: HOME_DONE },
  {
    label: 'Home → All tasks',
    pushes: 'State push on All tasks',
    target: `__shell.byText('header button', 'Tasks') || __shell.byText('nav [data-highlight-item]', 'All tasks')`,
    done: `location.pathname === '/tasks'`,
  },
  { label: 'All tasks → Home', target: HOME, done: HOME_DONE },
  {
    label: 'Home → Settings',
    target: `document.querySelector('header button[aria-label="Settings"]') || __shell.byText('nav [data-highlight-item]', 'Settings')`,
    done: `location.pathname === '/settings'`,
  },
  { label: 'Settings → Home', pushes: 'State push on Home', target: HOME, done: HOME_DONE },
  {
    label: '⌘K opens',
    key: { key: 'k', code: 'KeyK', keyCode: 75, modifiers: META },
    done: `!!document.querySelector('[cmdk-input]')`,
  },
];

const STEPS = Bun.env.SHELL_PERF_STEPS === 'terminal' ? TERMINAL_STEPS : NAVIGATION_STEPS;

async function attach(port: string) {
  const target = (await listTargets(port)).find(
    (entry) => entry.type === 'page' && entry.url.startsWith(ORIGIN)
  );
  if (!target) throw new Error(`No page on ${ORIGIN} at port ${port}.`);
  const page = await ShellPage.open(target.webSocketDebuggerUrl);
  return { page, close: () => page.close() };
}

async function waitFor(target: ShellPage, expression: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      await target.evaluate<boolean>(
        `(() => { try { return !!(${expression}); } catch { return false; } })()`
      )
    )
      return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function press(target: ShellPage, key: NonNullable<Step['key']>) {
  const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers: key.modifiers };
  await target.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await target.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function click(target: ShellPage, point: { x: number; y: number }) {
  await target.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await Bun.sleep(HOVER_MS);
  await target.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    clickCount: 1,
  });
  await target.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    clickCount: 1,
  });
}

async function openFirst(target: ShellPage, open: NonNullable<Step['open']>) {
  const point = await target.evaluate<{ x: number; y: number } | null>(
    `__shell.center(${JSON.stringify(open.target)})`
  );
  if (!point) return;
  await click(target, point);
  await waitFor(target, open.done);
  await Bun.sleep(OPEN_SETTLE_MS);
}

async function runStep(target: ShellPage, step: Step): Promise<Measured | null> {
  if (step.open) await openFirst(target, step.open);
  if (step.target) {
    const point = await target.evaluate<{ x: number; y: number } | null>(
      `__shell.center(${JSON.stringify(step.target)})`
    );
    if (!point) return null;
    await target.evaluate(`__shell.arm(${JSON.stringify(step.done)}, 'click')`);
    await click(target, point);
  } else if (step.key) {
    await target.evaluate(`__shell.arm(${JSON.stringify(step.done)}, 'keydown')`);
    await press(target, step.key);
  }
  return target.evaluate<Measured | null>('__shell.step');
}

async function closeMenu(target: ShellPage) {
  await press(target, { key: 'Escape', code: 'Escape', keyCode: 27, modifiers: 0 });
  await waitFor(target, `!document.querySelector('[cmdk-input]')`);
}

async function closeOpenMenu(target: ShellPage) {
  await target.evaluate(
    `document.querySelector('[role=menu][data-open]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
  );
  await waitFor(target, `!document.querySelector('[role=menu][data-open]')`);
}

function openBrowser() {
  if (ATTACH) return attach(ATTACH);
  return launchChrome(1440, 1000);
}

const browser = await openBrowser();
const { page } = browser;
await page.send('Page.enable');
if (Bun.env.SHELL_PERF_CPU)
  await page.send('Emulation.setCPUThrottlingRate', { rate: Number(Bun.env.SHELL_PERF_CPU) });
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SHELL_PROBE });
await page.send('Page.navigate', { url: `${ORIGIN}/` });
await waitFor(page, `window.__shell && ${HOME_DONE}`);
await page.evaluate('__shell.idle(1500)');

const SETTLE_MS = Number(Bun.env.SHELL_PERF_SETTLE_MS ?? 0);
const settles: { label: string; settledAt: number; maxGap: number }[] = [];
const cold: StepSample[] = [];
const warm: StepSample[] = [];
const pushes: StepSample[] = [];
const PUSHES_PER_PAGE = Number(Bun.env.SHELL_PERF_PUSHES ?? 3);
for (let lap = 0; lap < LAPS; lap += 1) {
  for (const step of STEPS) {
    const measured = await runStep(page, step);
    if (measured) (lap === 0 ? cold : warm).push({ label: step.label, ...measured });
    else console.warn(`Skipped ${step.label} on lap ${lap + 1}`);
    if (measured && SETTLE_MS > 0)
      settles.push({
        label: `${step.label}${lap === 0 ? ' (first)' : ''}`,
        ...(await page.evaluate<{ settledAt: number; maxGap: number }>(`__shell.settle(${SETTLE_MS})`)),
      });
    if (step.key) await closeMenu(page);
    if (step.open) await closeOpenMenu(page);
    await page.evaluate('__shell.idle(250)');
    for (let push = 0; measured && step.pushes && push < PUSHES_PER_PAGE; push += 1) {
      pushes.push({ label: step.pushes, ...(await page.evaluate<Measured>('__shell.push()')) });
      await page.evaluate('__shell.idle(100)');
    }
  }
}

const report = {
  origin: ORIGIN,
  laps: LAPS,
  cold: summarizeSteps(cold),
  warm: summarizeSteps(warm),
  pushes: summarizeSteps(pushes),
};
console.log(`First visit (lap 1), ${ORIGIN}\n\n${serializeStepTable(report.cold)}\n`);
console.log(`Revisits (laps 2–${LAPS})\n\n${serializeStepTable(report.warm)}\n`);
console.log(
  `State pushes (one task's priority changes; push to paint)\n\n${serializeStepTable(report.pushes)}`
);
if (SETTLE_MS > 0) {
  const labels = [...new Set(settles.map((each) => each.label))];
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  console.log('\nSettled (click to the last frame longer than 34 ms, and the longest frame)\n');
  for (const label of labels) {
    const mine = settles.filter((each) => each.label === label);
    console.log(
      `| ${label} | ${median(mine.map((each) => each.settledAt)).toFixed(1)} ms | ${median(mine.map((each) => each.maxGap)).toFixed(1)} ms |`
    );
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify({ ...report, samples: { cold, warm, pushes } }, null, 2));
browser.close();
process.exit(0);
