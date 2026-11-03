import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpPage } from './page.ts';
import {
  type Browser,
  CHROMIUM_IN_BUILD,
  DESKTOP_WINDOW,
  LAUNCH_TIMEOUT_MS,
  PLAYWRIGHT_CACHE,
  POLL_MS,
  SYSTEM_CHROME,
  WAIT_TIMEOUT_MS,
  type Target,
} from './schema.ts';

function findChromium() {
  if (Bun.env.SHINSA_PERF_CHROME) return Bun.env.SHINSA_PERF_CHROME;
  const cache = join(homedir(), PLAYWRIGHT_CACHE);
  const builds = existsSync(cache) ? readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)) : [];
  const found = [
    ...builds
      .sort()
      .reverse()
      .map((build) => join(cache, build, CHROMIUM_IN_BUILD)),
    SYSTEM_CHROME,
  ].find((binary) => existsSync(binary));
  if (!found) throw new Error('No Chromium found: set SHINSA_PERF_CHROME to a Chrome binary.');
  return found;
}

export async function listTargets(port: number | string) {
  return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Target[];
}

export async function launchChromium(width: number, height: number): Promise<Browser> {
  const port = Number(Bun.env.PERF_CDP_PORT) || 9600 + Math.floor(Math.random() * 300);
  const profile = mkdtempSync(join(tmpdir(), 'shinsa-perf-'));
  const chrome = Bun.spawn(
    [
      findChromium(),
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      ...(Bun.env.CI ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'pipe' }
  );
  const stop = () => {
    chrome.kill();
    rmSync(profile, { recursive: true, force: true });
  };
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await Bun.sleep(100);
    const target = await listTargets(port).then(
      (targets) => targets.find((entry) => entry.type === 'page'),
      () => undefined
    );
    if (!target) continue;
    const page = await CdpPage.open(target.webSocketDebuggerUrl);
    return {
      page,
      close: () => {
        page.close();
        stop();
      },
    };
  }
  stop();
  const output = (await new Response(chrome.stderr).text()).trim().slice(-2000);
  throw new Error(
    output
      ? `Chromium did not open a page within 30 seconds:\n${output}`
      : 'Chromium did not open a page within 30 seconds.'
  );
}

async function attachChromium(port: number | string, origin: string): Promise<Browser> {
  const target = (await listTargets(port)).find(
    (entry) => entry.type === 'page' && entry.url.startsWith(origin)
  );
  if (!target) throw new Error(`No page on ${origin} at port ${port}.`);
  const page = await CdpPage.open(target.webSocketDebuggerUrl);
  return { page, close: () => page.close() };
}

export function openChromium(attachPort: string | null, origin: string) {
  if (attachPort) return attachChromium(attachPort, origin);
  return launchChromium(DESKTOP_WINDOW.width, DESKTOP_WINDOW.height);
}

export async function waitForExpression(page: CdpPage, expression: string, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      await page.evaluate<boolean>(`(() => { try { return !!(${expression}); } catch { return false; } })()`)
    )
      return true;
    await Bun.sleep(POLL_MS);
  }
  return false;
}
