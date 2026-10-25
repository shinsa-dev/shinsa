import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = Bun.env.SHINSA_PERF_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Reply {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

interface Evaluated<T> {
  result: { value: T };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

export interface Page {
  send: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
}

export interface Browser {
  page: Page;
  close: () => void;
}

function connect(url: string): Promise<{ page: Page; socket: WebSocket }> {
  const socket = new WebSocket(url);
  const pending = new Map<number, Pending>();
  let next = 0;
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as Reply;
    if (reply.id === undefined) return;
    const waiting = pending.get(reply.id);
    pending.delete(reply.id);
    if (reply.error) waiting?.reject(new Error(reply.error.message));
    else waiting?.resolve(reply.result);
  });
  const send = <T>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      next += 1;
      pending.set(next, { resolve: resolve as (value: unknown) => void, reject });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  const evaluate = async <T>(expression: string) => {
    const reply = await send<Evaluated<T>>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (reply.exceptionDetails)
      throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  };
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ page: { send, evaluate }, socket }), { once: true });
    socket.addEventListener('error', () => reject(new Error('The debugging socket did not open.')), {
      once: true,
    });
  });
}

export async function createBrowser(width: number, height: number): Promise<Browser> {
  const port = Number(Bun.env.PERF_CDP_PORT) || 9800 + Math.floor(Math.random() * 150);
  const profile = mkdtempSync(join(tmpdir(), 'shinsa-code-perf-'));
  const chrome = Bun.spawn(
    [
      CHROME,
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
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
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      target = targets.find((entry) => entry.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('Chrome did not open a page.');
  const { page, socket } = await connect(target.webSocketDebuggerUrl);
  return {
    page,
    close: () => {
      socket.close();
      chrome.kill();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

export function median(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
  return Math.round(value * 10) / 10;
}
