import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

const CACHE = join(homedir(), 'Library/Caches/ms-playwright');

function findChrome() {
  if (Bun.env.SHINSA_PERF_CHROME) return Bun.env.SHINSA_PERF_CHROME;
  const builds = existsSync(CACHE)
    ? readdirSync(CACHE)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort()
    : [];
  for (const build of builds.reverse()) {
    const app = join(
      CACHE,
      build,
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    );
    if (existsSync(app)) return app;
  }
  throw new Error('No Chromium found: set SHINSA_PERF_CHROME to a Chrome binary.');
}

export class Page {
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
    return new Page(socket);
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

  listen(listener: (event: MessageEvent) => void) {
    this.#socket.addEventListener('message', listener);
  }

  close() {
    this.#socket.close();
  }
}

export async function launch(width = 1280, height = 900) {
  const port = Bun.env.SHINSA_PERF_DEBUG_PORT
    ? Number(Bun.env.SHINSA_PERF_DEBUG_PORT)
    : 9300 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), 'shinsa-perf-'));
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
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
    await Bun.sleep(100);
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      target = targets.find((entry) => entry.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('Chromium did not open a page.');
  const page = await Page.open(target.webSocketDebuggerUrl);
  return {
    page,
    close: () => {
      page.close();
      chrome.kill();
    },
  };
}
