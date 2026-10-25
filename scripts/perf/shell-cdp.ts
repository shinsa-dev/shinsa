import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

const PLAYWRIGHT_CACHE = join(homedir(), 'Library/Caches/ms-playwright');
const CHROME_IN_BUILD =
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

function findChrome() {
  if (Bun.env.SHELL_PERF_CHROME) return Bun.env.SHELL_PERF_CHROME;
  const builds = existsSync(PLAYWRIGHT_CACHE)
    ? readdirSync(PLAYWRIGHT_CACHE).filter((name) => /^chromium-\d+$/.test(name))
    : [];
  const found = builds
    .sort()
    .reverse()
    .map((build) => join(PLAYWRIGHT_CACHE, build, CHROME_IN_BUILD))
    .find((binary) => existsSync(binary));
  if (!found) throw new Error('No Chromium found: set SHELL_PERF_CHROME to a Chrome binary.');
  return found;
}

export class ShellPage {
  #socket: WebSocket;
  #id = 0;
  #pending = new Map<number, Pending>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message));
      else pending?.resolve(message.result);
    });
  }

  static async open(url: string) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new ShellPage(socket);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.#id;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{
      result: { value: T };
      exceptionDetails?: { exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return result.result.value;
  }

  close() {
    this.#socket.close();
  }
}

export async function listTargets(port: number | string) {
  return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Target[];
}

export async function launchChrome(width: number, height: number) {
  const port = Number(Bun.env.PERF_CDP_PORT) || 9600 + Math.floor(Math.random() * 300);
  const profile = mkdtempSync(join(tmpdir(), 'shinsa-shell-perf-'));
  const chrome = Bun.spawn(
    [
      findChrome(),
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'ignore' }
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await Bun.sleep(100);
    const target = await listTargets(port).then(
      (targets) => targets.find((entry) => entry.type === 'page'),
      () => undefined
    );
    if (!target) continue;
    const page = await ShellPage.open(target.webSocketDebuggerUrl);
    return {
      page,
      close: () => {
        page.close();
        chrome.kill();
      },
    };
  }
  chrome.kill();
  throw new Error('Chromium did not open a page.');
}
