import type { FileSink, Subprocess } from 'bun';
import { HEADLESS_BROWSER_ENV } from '../../../extensions/definitions.ts';
import { describeError } from '../../../log/index.ts';
import { killProcessGroup } from '../../../shell/index.ts';

type RequestId = string | number;

type Params = Record<string, unknown>;

type NotificationHandler = (method: string, params: Params) => void;

type RequestHandler = (method: string, params: Params) => Promise<unknown>;

export function readRecord(value: unknown): Params {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Params) : {};
}

export function readText(record: Params, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface CodexClientOptions {
  path: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}

const STDERR_LINES = 20;

export class CodexRequestError extends Error {
  override name = 'CodexRequestError';
  readonly method: string;

  constructor(method: string, message: string) {
    super(message);
    this.method = method;
  }
}

function readParams(value: unknown): Params {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Params) : {};
}

function readErrorMessage(value: unknown) {
  const message = readParams(value).message;
  return typeof message === 'string' && message ? message : 'Codex refused the request.';
}

function parseLine(line: string): Params | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Params) : null;
  } catch {
    return null;
  }
}

function resolveCodexEnv(extra: Record<string, string | undefined>) {
  const { CLAUDECODE: _claudeCode, ...env } = Bun.env;
  return { ...env, ...HEADLESS_BROWSER_ENV, ...extra };
}

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      onLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) onLine(buffer);
}

export class CodexClient {
  readonly #process: Subprocess<'pipe', 'pipe', 'pipe'>;
  readonly #stdin: FileSink;
  readonly #pending = new Map<RequestId, Pending>();
  readonly #stderr: string[] = [];
  readonly #exitHandlers: ((message: string) => void)[] = [];
  #notify: NotificationHandler = () => undefined;
  #request: RequestHandler = () => Promise.reject(new Error('No handler for this request.'));
  #nextId = 0;
  #closed = false;
  readonly exited: Promise<void>;

  constructor(options: CodexClientOptions) {
    this.#process = Bun.spawn([options.path, 'app-server'], {
      cwd: options.cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
      env: resolveCodexEnv(options.env ?? {}),
    });
    this.#stdin = this.#process.stdin;
    const stdout = readLines(this.#process.stdout, (line) => this.#receive(line));
    const stderr = readLines(this.#process.stderr, (line) => this.#keepStderr(line));
    this.exited = Promise.allSettled([this.#process.exited, stdout, stderr]).then(([code]) => {
      const exit = code.status === 'fulfilled' ? code.value : 'unknown';
      this.#end(`Codex’s app server exited with code ${exit}.`);
    });
  }

  onNotification(handler: NotificationHandler) {
    this.#notify = handler;
  }

  onRequest(handler: RequestHandler) {
    this.#request = handler;
  }

  onExit(handler: (message: string) => void) {
    this.#exitHandlers.push(handler);
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'shinsa', title: 'Shinsa', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.#write({ method: 'initialized' });
  }

  request<T = Params>(method: string, params: Params): Promise<T> {
    if (this.#closed) return Promise.reject(new CodexRequestError(method, 'Codex’s app server has stopped.'));
    this.#nextId += 1;
    const id = this.#nextId;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    this.#pending.set(id, { method, resolve, reject });
    this.#write({ id, method, params });
    return promise as Promise<T>;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#fail('Codex’s app server was stopped.');
    killProcessGroup(this.#process.pid);
  }

  #write(message: Params) {
    if (this.#closed) return;
    this.#stdin.write(`${JSON.stringify(message)}\n`);
    this.#stdin.flush();
  }

  #keepStderr(line: string) {
    if (!line.trim()) return;
    this.#stderr.push(line.trim().slice(-2_000));
    if (this.#stderr.length > STDERR_LINES) this.#stderr.shift();
  }

  #receive(line: string) {
    const message = parseLine(line);
    if (!message) return;
    const { id, method } = message;
    if (typeof method === 'string' && (typeof id === 'number' || typeof id === 'string')) {
      void this.#answer(id, method, readParams(message.params));
      return;
    }
    if (typeof method === 'string') {
      this.#notify(method, readParams(message.params));
      return;
    }
    if (typeof id === 'number' || typeof id === 'string') this.#settle(id, message);
  }

  #settle(id: RequestId, message: Params) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    if (message.error !== undefined) {
      pending.reject(new CodexRequestError(pending.method, readErrorMessage(message.error)));
      return;
    }
    pending.resolve(message.result);
  }

  async #answer(id: RequestId, method: string, params: Params) {
    try {
      this.#write({ id, result: await this.#request(method, params) });
    } catch (error) {
      this.#write({ id, error: { code: -32000, message: describeError(error) } });
    }
  }

  #fail(message: string) {
    for (const pending of this.#pending.values())
      pending.reject(new CodexRequestError(pending.method, message));
    this.#pending.clear();
  }

  #end(fallback: string) {
    const wasClosed = this.#closed;
    this.#closed = true;
    const message = this.#stderr.at(-1) ?? fallback;
    this.#fail(message);
    if (wasClosed) return;
    killProcessGroup(this.#process.pid);
    for (const handler of this.#exitHandlers) handler(message);
  }
}
