import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { listTargets, ShellPage } from '../perf/shell-cdp.ts';

type Theme = 'light' | 'dark';

interface AppWindow {
  id: number;
  title: string;
  bounds: { X: number; Y: number; Width: number; Height: number };
}

const ROOT = resolve(import.meta.dirname, '../..');
const WORK = Bun.env.SHINSA_SHOTS_DIR ?? '/tmp/shinsa-shots';
const ASSETS = join(ROOT, '.github/assets');
const WINDOW = { width: 1000, height: 700 };
const THEMES: Theme[] = ['light', 'dark'];
const DEV_PREFS = join(homedir(), 'Library/Application Support/Shinsa Dev/prefs.json');
const WINDOWS_HELPER = join(import.meta.dirname, 'windows.swift');
const TIMEOUT_MS = 60_000;

const env: Record<string, string | undefined> = { ...Bun.env };
for (const key of ['SHINSA_HOME', 'SHINSA_URL', 'SHINSA_PORT', 'SHINSA_WEB_DIR', 'SHINSA_DATA_DIR'])
  delete env[key];

const cleanups: (() => void | Promise<void>)[] = [];

function runStep(label: string, command: string[], cwd: string, extra: Record<string, string> = {}) {
  console.log(`· ${label}`);
  const result = Bun.spawnSync(command, { cwd, env: { ...env, ...extra }, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0)
    throw new Error(`${command.join(' ')} failed:\n${result.stderr.toString()}${result.stdout.toString()}`);
  return result.stdout.toString();
}

function reservePort() {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error('No free port.');
  return port;
}

async function waitFor<T>(label: string, attempt: () => Promise<T | null | undefined>) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await attempt().catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value;
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function startEngine(port: number) {
  const data = join(WORK, 'data');
  const engine = Bun.spawn(['bun', 'src/main.ts', 'engine'], {
    cwd: join(ROOT, 'apps/engine'),
    env: {
      ...env,
      SHINSA_DATA_DIR: data,
      SHINSA_INSPECT: '1',
      SHINSA_PORT: String(port),
      SHINSA_WEB_DIR: join(WORK, 'web'),
    },
    stdout: Bun.file(join(WORK, 'engine.log')),
    stderr: Bun.file(join(WORK, 'engine.err.log')),
  });
  cleanups.push(async () => {
    engine.kill('SIGTERM');
    await engine.exited;
  });
  const origin = `http://127.0.0.1:${port}`;
  return waitFor('the engine', async () => {
    const health = (await (await fetch(`${origin}/api/health`)).json()) as { ok: boolean; dataDir: string };
    return health.ok && health.dataDir === data ? origin : null;
  });
}

function keepDevPrefs() {
  const saved = existsSync(DEV_PREFS) ? readFileSync(DEV_PREFS, 'utf8') : null;
  cleanups.push(() => {
    if (saved === null) rmSync(DEV_PREFS, { force: true });
    else writeFileSync(DEV_PREFS, saved);
  });
}

async function launchApp(origin: string) {
  const mainPort = reservePort();
  const pagePort = reservePort();
  const launcher = Bun.spawn(
    ['bun', 'scripts/dev.ts', `--inspect=${mainPort}`, `--remote-debugging-port=${pagePort}`],
    {
      cwd: join(ROOT, 'apps/desktop'),
      env: { ...env, SHINSA_URL: origin },
      stdout: Bun.file(join(WORK, 'app.log')),
      stderr: Bun.file(join(WORK, 'app.err.log')),
    }
  );
  const app: { main: ShellPage | null; pid: number | null } = { main: null, pid: null };
  cleanups.push(async () => {
    await app.main?.evaluate(`process.mainModule.require('electron').app.quit()`).catch(() => undefined);
    app.main?.close();
    const exited = await Promise.race([launcher.exited.then(() => true), Bun.sleep(8000).then(() => false)]);
    if (exited) return;
    if (app.pid) process.kill(app.pid, 'SIGTERM');
    launcher.kill('SIGTERM');
    await launcher.exited;
  });
  const main = await waitFor('the app', async () => {
    const target = (await listTargets(mainPort)).find((entry) => entry.type === 'node');
    return target ? ShellPage.open(target.webSocketDebuggerUrl) : null;
  });
  app.main = main;
  app.pid = await main.evaluate<number>('process.pid');
  const page = await waitFor('the page', async () => {
    const target = (await listTargets(pagePort)).find(
      (entry) => entry.type === 'page' && entry.url.startsWith(origin)
    );
    return target ? ShellPage.open(target.webSocketDebuggerUrl) : null;
  });
  cleanups.push(async () => {
    await page.evaluate(`localStorage.removeItem('shinsa.theme')`).catch(() => undefined);
    page.close();
  });
  return { main, page, pid: app.pid };
}

function placeWindow(main: ShellPage, theme: Theme) {
  return main.evaluate<boolean>(`(() => {
    const { app, BrowserWindow, nativeTheme, screen } = process.mainModule.require('electron');
    nativeTheme.themeSource = '${theme}';
    const win = BrowserWindow.getAllWindows().find((each) => each.isVisible()) ?? BrowserWindow.getAllWindows()[0];
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const half = (start, size, point, length) => {
      const left = point >= start + size / 2;
      const room = size / 2;
      const offset = Math.max(0, Math.round((room - length) / 2));
      return left ? start + offset : start + size - length - offset;
    };
    win.setBounds({
      x: half(area.x, area.width, cursor.x, ${WINDOW.width}),
      y: half(area.y, area.height, cursor.y, ${WINDOW.height}),
      width: ${WINDOW.width},
      height: ${WINDOW.height},
    });
    win.show();
    win.focus();
    app.focus({ steal: true });
    return win.isFocused();
  })()`);
}

function isPageSettled(page: ShellPage, theme: Theme) {
  return page.evaluate<boolean>(`(async () => {
    await document.fonts.ready;
    document.activeElement?.blur?.();
    return document.fonts.status === 'loaded'
      && !!document.querySelector('main textarea')
      && !!document.querySelector('html[data-desktop="window"]')
      && document.documentElement.classList.contains('${theme}')
      && !document.querySelector('[aria-label="Reconnecting"]')
      && !document.querySelector('[data-sonner-toast]')
      && !document.querySelector('.animate-spin');
  })()`);
}

function findAppWindow(pid: number) {
  const windows = JSON.parse(
    runStep('find the window', ['swift', WINDOWS_HELPER, String(pid)], ROOT)
  ) as AppWindow[];
  const match = windows.find(
    (each) => each.bounds.Width === WINDOW.width && each.bounds.Height === WINDOW.height
  );
  if (!match)
    throw new Error(`No ${WINDOW.width}×${WINDOW.height} window for pid ${pid}: ${JSON.stringify(windows)}`);
  return match.id;
}

function writeImage(raw: string, target: string) {
  const pngquant = Bun.which('pngquant');
  if (!pngquant) {
    console.log('  pngquant is not installed (brew install pngquant): writing the capture as is');
    copyFileSync(raw, target);
    return;
  }
  runStep(
    `shrink ${target}`,
    [pngquant, '--quality', '75-95', '--speed', '1', '--strip', '--force', '--output', target, raw],
    ROOT
  );
}

async function captureTheme(main: ShellPage, page: ShellPage, pid: number, theme: Theme) {
  await placeWindow(main, theme);
  let calm = 0;
  await waitFor(`the ${theme} page to settle`, async () => {
    calm = (await isPageSettled(page, theme)) ? calm + 1 : 0;
    return calm >= 5;
  });
  await Bun.sleep(1200);
  await waitFor('the window to have focus', () => placeWindow(main, theme));
  await Bun.sleep(400);
  const raw = join(WORK, `shinsa-${theme}.raw.png`);
  runStep(
    `capture ${theme}`,
    ['screencapture', '-l', String(findAppWindow(pid)), '-x', '-t', 'png', raw],
    ROOT
  );
  writeImage(raw, join(ASSETS, `shinsa-${theme}.png`));
}

async function cleanUp() {
  for (const step of cleanups.splice(0).reverse()) await Promise.resolve(step()).catch(console.error);
}

process.on('SIGINT', () => void cleanUp().then(() => process.exit(130)));

try {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  runStep('seed', ['bun', 'scripts/seed.ts'], ROOT, { SHINSA_SEED_DIR: WORK });
  runStep(
    'build the web app',
    ['bun', 'run', 'build', '--outDir', join(WORK, 'web'), '--emptyOutDir'],
    join(ROOT, 'apps/web')
  );
  runStep('build the app', ['bun', 'run', 'build'], join(ROOT, 'apps/desktop'));
  const origin = await startEngine(reservePort());
  console.log(`· engine on ${origin}`);
  keepDevPrefs();
  const { main, page, pid } = await launchApp(origin);
  await page.evaluate(`localStorage.removeItem('shinsa.theme'); location.reload()`).catch(() => undefined);
  for (const theme of THEMES) await captureTheme(main, page, pid, theme);
  console.log(`Wrote ${THEMES.map((theme) => join(ASSETS, `shinsa-${theme}.png`)).join(' and ')}`);
} finally {
  await cleanUp();
}
