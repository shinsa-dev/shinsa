import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Body,
  CORE_DEFAULTS,
  type CoreConfig,
  claudeCodeSessionId,
  createForwarder,
  createWindowLookup,
  foldThread,
  type Prepared,
  rewriteAsync,
  type ThreadState,
  type ThreadStore,
  type WindowLookup,
} from '@chroxify/eunoe';
import type { ChatNotice } from '@shinsa/core';
import type { EunoeLink, EunoeStatus, EunoeWatcher } from '../agents/providers/claude/index.ts';
import { DIRECT_BASE_URL } from '../agents/providers/claude/route.ts';
import { describeError, log } from '../log/index.ts';

export interface EunoeServerOptions {
  dir: string;
  upstream?: string;
  port?: number;
  window?: WindowLookup;
  tuning?: Partial<CoreConfig>;
}

type Entry = Record<string, unknown>;

const STOPPING = 'Shinsa is stopping.';

const IDLE_TIMEOUT_S = 255;

function resolveThreadFile(dir: string, key: string) {
  return join(dir, `${key.replace(/[^\w-]/g, '_')}.json`);
}

export function createFileStore(dir: string): ThreadStore {
  return {
    read: (key) => {
      try {
        return JSON.parse(readFileSync(resolveThreadFile(dir, key), 'utf8')) as ThreadState;
      } catch {
        return {};
      }
    },
    save: (key, state) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolveThreadFile(dir, key), JSON.stringify(state));
    },
  };
}

export function resolveCompactionNotice(entry: Entry): ChatNotice | null {
  if (entry.compacted !== true) return null;
  const actions = Array.isArray(entry.actions) ? entry.actions : [];
  return {
    kind: 'compaction',
    trigger: actions.includes('cut') ? 'auto' : 'fold',
    preTokens: null,
    summary: null,
    by: 'eunoe',
  };
}

export function isStuck(entry: Entry) {
  return typeof entry.stuck === 'object' && entry.stuck !== null && entry.fit === 'over';
}

export class EunoeServer implements EunoeLink {
  readonly dir: string;
  readonly #upstream: string;
  readonly #port: number;
  readonly #window: WindowLookup;
  readonly #config: CoreConfig;
  readonly #store: ThreadStore;
  readonly #watchers = new Map<string, Set<EunoeWatcher>>();
  readonly #folds = new Map<string, object>();
  #server: ReturnType<typeof Bun.serve> | null = null;
  #stopped = false;

  constructor(options: EunoeServerOptions) {
    this.dir = options.dir;
    this.#upstream = options.upstream ?? DIRECT_BASE_URL;
    this.#port = options.port ?? 0;
    this.#window = options.window ?? createWindowLookup();
    this.#config = { ...CORE_DEFAULTS, mode: 'compact', ...options.tuning };
    this.#store = createFileStore(join(this.dir, 'threads'));
  }

  ensure(): Promise<EunoeStatus> {
    if (this.#stopped) return Promise.resolve({ ok: false, reason: STOPPING });
    try {
      this.#server ??= this.#serve();
    } catch (error) {
      const reason = `Eunoe could not start: ${describeError(error)}`;
      log.warn('[Eunoe] The forwarder is not available; runs talk to Claude directly', { reason });
      return Promise.resolve({ ok: false, reason });
    }
    return Promise.resolve({ ok: true, url: `http://127.0.0.1:${this.#server.port}`, dir: this.dir });
  }

  watch(sessionId: string, watcher: EunoeWatcher) {
    const watchers = this.#watchers.get(sessionId) ?? new Set();
    watchers.add(watcher);
    this.#watchers.set(sessionId, watchers);
    return () => {
      watchers.delete(watcher);
      if (watchers.size === 0) this.#watchers.delete(sessionId);
    };
  }

  fold(sessionId: string) {
    const token = {};
    this.#folds.set(sessionId, token);
    return () => {
      if (this.#folds.get(sessionId) === token) this.#folds.delete(sessionId);
    };
  }

  async stop() {
    this.#stopped = true;
    const server = this.#server;
    this.#server = null;
    await server?.stop(true);
  }

  #serve() {
    mkdirSync(this.dir, { recursive: true });
    const forward = createForwarder({
      store: this.#store,
      upstream: this.#upstream,
      prepare: (request, body, mayCompact) => this.#prepare(request, body, mayCompact),
      record: (entry) => this.#record(entry),
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: this.#port,
      idleTimeout: IDLE_TIMEOUT_S,
      fetch: forward,
    });
    log.info('[Eunoe] Serving the forwarder', { port: server.port, dir: this.dir });
    return server;
  }

  async #prepare(request: Request, body: Body, mayCompact: boolean): Promise<Prepared> {
    const threadId = claudeCodeSessionId(request.headers, body);
    const window = await this.#window(body.model, request.headers, this.#upstream);
    const folded = threadId !== null && mayCompact && this.#foldPending(threadId, body);
    const result = await rewriteAsync({
      body,
      threadId,
      config: this.#config,
      store: this.#store,
      window,
      mayCompact,
    });
    if (!folded) return result;
    const actions = [...(result.note.actions ?? []), 'fold'];
    return { ...result, note: { ...result.note, compacted: true, actions } };
  }

  #foldPending(threadId: string, body: Body) {
    if (!this.#folds.has(threadId) || !Array.isArray(body.tools) || body.tools.length === 0) return false;
    try {
      foldThread({ store: this.#store, threadId, messages: body.messages }, { at: 'latest' });
    } catch (error) {
      log.info('[Eunoe] Nothing to fold before this turn yet', { threadId, reason: describeError(error) });
      return false;
    }
    this.#folds.delete(threadId);
    return true;
  }

  #record(entry: Entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), mode: this.#config.mode, ...entry });
    try {
      appendFileSync(join(this.dir, 'requests.jsonl'), `${line}\n`);
    } catch (error) {
      log.warn('[Eunoe] Could not write the request log', { error: describeError(error) });
    }
    const thread = entry.thread;
    if (typeof thread !== 'string') return;
    const notice = resolveCompactionNotice(entry);
    const stuck = isStuck(entry);
    if (!notice && !stuck) return;
    for (const [sessionId, watchers] of this.#watchers) {
      if (!thread.startsWith(`${sessionId}-`)) continue;
      for (const watcher of watchers) {
        if (notice) watcher.notice(notice);
        if (stuck) watcher.stuck();
      }
    }
  }
}
