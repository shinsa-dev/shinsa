import { once } from 'node:events';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Subprocess } from 'bun';
import type { EunoeLink, EunoeListener, EunoeMode, EunoeStatus } from '../agents/providers/claude/index.ts';
import { DIRECT_BASE_URL } from '../agents/providers/claude/route.ts';
import { writeJsonFile } from '../config/index.ts';
import { BUNDLE, type ShinsaBundle } from '../instance/bundle.ts';
import { describeError, log } from '../log/index.ts';
import { killProcessGroup } from '../shell/index.ts';
import { EUNOE_COMMAND } from './command.ts';
import { EunoeRequestWatch } from './requests.ts';

export interface EunoeProxyOptions {
  dir: string;
  command: string[] | null;
  port?: number | null;
  startTimeoutMs?: number;
  retryAfterMs?: number;
  pollMs?: number;
  now?: () => number;
}

interface Health {
  ok: boolean;
  pid: number | null;
}

interface EunoeConfig {
  port: number;
  mode: EunoeMode;
  upstream: string;
  claudeConfigDirs: string[];
}

const HEALTH_PATH = '/_eunoe/health';

const PROBE_TIMEOUT_MS = 800;

const START_TIMEOUT_MS = 15_000;

const RETRY_AFTER_MS = 60_000;

const FRESH_MS = 5_000;

const LOG_LINE = 300;

const STOPPING = 'Shinsa is stopping.';

const NOT_INSTALLED = 'Eunoe is not installed with this Shinsa.';

const BUNDLED_MAIN = '@chroxify/eunoe/src/cli/main.ts';

export function resolveEunoeCommand(
  configured: string | null,
  resolveModule: (specifier: string) => string = (specifier) => import.meta.resolve(specifier),
  bundle: ShinsaBundle | null = BUNDLE
): string[] | null {
  if (configured) return [configured.replace(/^~(?=\/|$)/, homedir())];
  if (bundle) return [join(bundle.bin, 'shinsa'), EUNOE_COMMAND];
  try {
    return [process.execPath, fileURLToPath(resolveModule(BUNDLED_MAIN))];
  } catch (error) {
    log.warn('[Eunoe] The bundled eunoe could not be found', { error: describeError(error) });
    return null;
  }
}

function resolveSentence(text: string) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function describeSpawnError(path: string, error: unknown) {
  if ((error as { code?: unknown }).code === 'ENOENT') return `Eunoe was not found at ${path}.`;
  return `Eunoe could not start: ${describeError(error)}`;
}

function resolveUrl(port: number) {
  return `http://127.0.0.1:${port}`;
}

async function probe(port: number): Promise<Health | null> {
  try {
    const response = await fetch(`${resolveUrl(port)}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const health = (await response.json()) as { ok?: unknown; pid?: unknown };
    return { ok: health.ok === true, pid: typeof health.pid === 'number' ? health.pid : null };
  } catch {
    return null;
  }
}

async function isAnswering(port: number) {
  try {
    await fetch(`${resolveUrl(port)}${HEALTH_PATH}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

async function pickFreePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

function readNumberFile(path: string) {
  try {
    const value = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function readConfiguredPort(path: string) {
  try {
    const port = (JSON.parse(readFileSync(path, 'utf8')) as { port?: unknown }).port;
    return typeof port === 'number' && Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function readLastLine(path: string) {
  const line = readFileSync(path, 'utf8').trim().split('\n').at(-1)?.trim();
  return line ? line.slice(0, LOG_LINE) : null;
}

export class EunoeProxy implements EunoeLink {
  readonly dir: string;
  readonly #command: string[] | null;
  readonly #pinnedPort: number | null;
  readonly #startTimeoutMs: number;
  readonly #retryAfterMs: number;
  readonly #now: () => number;
  readonly #requests: EunoeRequestWatch;
  readonly #configDirs = new Set<string>();
  #config: EunoeConfig | null = null;
  #process: Subprocess | null = null;
  #adopted: number | null = null;
  #healthyAt = 0;
  #failure: { at: number; reason: string } | null = null;
  #starting: Promise<EunoeStatus> | null = null;
  #stopped = false;

  constructor(options: EunoeProxyOptions) {
    this.dir = options.dir;
    this.#command = options.command;
    this.#pinnedPort = options.port ?? null;
    this.#startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
    this.#retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_MS;
    this.#now = options.now ?? Date.now;
    this.#requests = new EunoeRequestWatch(join(this.dir, 'requests.jsonl'), options.pollMs);
  }

  get #configPath() {
    return join(this.dir, 'config.json');
  }

  get #pidPath() {
    return join(this.dir, 'serve.pid');
  }

  watch(sessionId: string, listener: EunoeListener) {
    return this.#requests.watch(sessionId, listener);
  }

  ensure(mode: EunoeMode, configDir: string | null): Promise<EunoeStatus> {
    if (this.#stopped) return Promise.resolve({ ok: false, reason: STOPPING });
    if (configDir) this.#configDirs.add(configDir);
    if (this.#config) this.#writeConfig({ ...this.#config, mode });
    if (this.#config && this.#now() - this.#healthyAt < FRESH_MS) {
      return Promise.resolve(this.#ready(this.#config.port));
    }
    this.#starting ??= this.#connect(mode).finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async stop() {
    this.#stopped = true;
    await this.#starting;
    const child = this.#process;
    this.#process = null;
    if (child) {
      killProcessGroup(child.pid);
      await child.exited;
    }
    if (this.#adopted !== null) killProcessGroup(this.#adopted);
    this.#adopted = null;
    rmSync(this.#pidPath, { force: true });
  }

  #ready(port: number): EunoeStatus {
    return { ok: true, url: resolveUrl(port), dir: this.dir };
  }

  #writeConfig(config: EunoeConfig) {
    const next = { ...config, claudeConfigDirs: [...this.#configDirs].sort() };
    if (JSON.stringify(next) === JSON.stringify(this.#config)) return;
    writeJsonFile(this.#configPath, next);
    this.#config = next;
  }

  async #connect(mode: EunoeMode): Promise<EunoeStatus> {
    mkdirSync(this.dir, { recursive: true });
    const port = this.#config?.port ?? this.#pinnedPort ?? readConfiguredPort(this.#configPath);
    if (port !== null && (await this.#isOurs(port))) return this.#serve(port, mode);
    const failure = this.#failure;
    if (failure && this.#now() - failure.at < this.#retryAfterMs)
      return { ok: false, reason: failure.reason };
    return this.#start(mode, port);
  }

  async #isOurs(port: number) {
    const health = await probe(port);
    if (!health?.ok) return false;
    if (this.#process && health.pid === this.#process.pid) return true;
    const recorded = readNumberFile(this.#pidPath);
    if (recorded === null || health.pid !== recorded) return false;
    this.#adopted = recorded;
    return true;
  }

  #serve(port: number, mode: EunoeMode): EunoeStatus {
    this.#writeConfig({ port, mode, upstream: DIRECT_BASE_URL, claudeConfigDirs: [] });
    this.#healthyAt = this.#now();
    this.#failure = null;
    return this.#ready(port);
  }

  #fail(text: string): EunoeStatus {
    const reason = resolveSentence(text);
    this.#failure = { at: this.#now(), reason };
    log.warn('[Eunoe] The proxy is not available; runs talk to Claude directly', { reason });
    return { ok: false, reason };
  }

  async #start(mode: EunoeMode, previous: number | null): Promise<EunoeStatus> {
    const command = this.#command;
    if (!command) return this.#fail(NOT_INSTALLED);
    const busy = previous !== null && (await isAnswering(previous));
    if (busy && this.#pinnedPort !== null)
      return this.#fail(`Port ${previous} is in use by another program.`);
    let port = busy ? null : previous;
    port ??= this.#pinnedPort ?? (await pickFreePort());
    this.#writeConfig({ port, mode, upstream: DIRECT_BASE_URL, claudeConfigDirs: [] });
    const logPath = join(this.dir, 'serve.log');
    const output = openSync(logPath, 'w');
    let child: Subprocess;
    try {
      child = Bun.spawn([...command, 'serve'], {
        cwd: this.dir,
        env: { ...Bun.env, EUNOE_DIR: this.dir },
        stdin: 'ignore',
        stdout: output,
        stderr: output,
        detached: true,
      });
    } catch (error) {
      return this.#fail(describeSpawnError(command[0] ?? '', error));
    } finally {
      closeSync(output);
    }
    this.#process = child;
    writeFileSync(this.#pidPath, String(child.pid));
    void child.exited.then((code) => this.#exited(child, code));
    log.info('[Eunoe] Starting the proxy', { port, mode, dir: this.dir });
    return this.#await(child, port, mode, logPath);
  }

  async #await(child: Subprocess, port: number, mode: EunoeMode, logPath: string): Promise<EunoeStatus> {
    const deadline = Date.now() + this.#startTimeoutMs;
    while (Date.now() < deadline && this.#process === child && !this.#stopped) {
      if ((await probe(port))?.ok) return this.#serve(port, mode);
      await Bun.sleep(100);
    }
    const exited = this.#process !== child;
    if (!exited) {
      this.#process = null;
      killProcessGroup(child.pid);
      await child.exited;
    }
    if (this.#stopped) return { ok: false, reason: STOPPING };
    const reason = exited
      ? 'Eunoe stopped before it answered'
      : `Eunoe did not answer within ${this.#startTimeoutMs / 1000} s`;
    const line = readLastLine(logPath);
    return this.#fail(line ? `${reason}: ${line}` : reason);
  }

  #exited(child: Subprocess, code: number | null) {
    if (this.#process !== child) return;
    this.#process = null;
    this.#healthyAt = 0;
    rmSync(this.#pidPath, { force: true });
    if (!this.#stopped) log.warn('[Eunoe] The proxy exited', { pid: child.pid, code });
  }
}
