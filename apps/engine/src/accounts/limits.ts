import { existsSync, readFileSync } from 'node:fs';
import type { AccountUsage, ChatNotice, UsageWindow } from '@shinsa/core';
import { writeJsonFile } from '../config/file.ts';
import { describeError, log } from '../log/index.ts';
import { KEYED_WINDOWS, type KeyedWindow, resolveWindowId, type UsageRead } from './usage.ts';

export type UsageReader = (accountId: string) => Promise<UsageRead>;

export interface UsageLimitsOptions {
  path: string;
  read: UsageReader;
  ttlMs?: number;
  now?: () => number;
  windows?: Record<string, KeyedWindow>;
  emptyDetail?: string;
}

type RateLimitNotice = Extract<ChatNotice, { kind: 'rate_limit' }>;

export const USAGE_TTL_MS = 60_000;

const LIMITED_BACKOFF_MS = 5 * 60_000;

const NO_WINDOWS = 'Claude reports no usage limits for this account.';

function resolvePushedPercent(notice: RateLimitNotice) {
  if (notice.status === 'rejected') return 100;
  if (notice.utilization === null) return null;
  return Math.min(100, Math.max(0, notice.utilization * 100));
}

export function createUnknownUsage(): AccountUsage {
  return { status: 'unknown', windows: [], detail: null, checkedAt: null, source: null };
}

function readCache(path: string): Map<string, AccountUsage> {
  const entries = new Map<string, AccountUsage>();
  if (!existsSync(path)) return entries;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { accounts?: Record<string, AccountUsage> };
    for (const [id, usage] of Object.entries(parsed.accounts ?? {})) {
      if (!Array.isArray(usage?.windows)) continue;
      entries.set(id, { ...usage, source: 'cache' });
    }
  } catch (error) {
    log.warn('[Accounts] The usage cache could not be read; starting without it', {
      path,
      error: describeError(error),
    });
  }
  return entries;
}

export class UsageLimits {
  readonly #options: UsageLimitsOptions;
  readonly #entries: Map<string, AccountUsage>;
  readonly #reading = new Map<string, Promise<void>>();
  readonly #listeners = new Set<() => void>();

  constructor(options: UsageLimitsOptions) {
    this.#options = options;
    this.#entries = readCache(options.path);
  }

  get #now() {
    return (this.#options.now ?? Date.now)();
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  snapshot(accountId: string): AccountUsage {
    return this.#entries.get(accountId) ?? createUnknownUsage();
  }

  #store(accountId: string, usage: AccountUsage) {
    this.#entries.set(accountId, usage);
    this.#persist();
    for (const listener of this.#listeners) listener();
  }

  #persist() {
    const accounts = Object.fromEntries(this.#entries);
    try {
      writeJsonFile(this.#options.path, { version: 1, accounts });
    } catch (error) {
      log.warn('[Accounts] Could not keep the usage cache', { error: describeError(error) });
    }
  }

  remove(accountId: string) {
    if (!this.#entries.delete(accountId)) return;
    this.#persist();
    for (const listener of this.#listeners) listener();
  }

  isFresh(accountId: string) {
    const checkedAt = this.#entries.get(accountId)?.checkedAt ?? null;
    return checkedAt !== null && this.#now - checkedAt < (this.#options.ttlMs ?? USAGE_TTL_MS);
  }

  async refresh(accountIds: string[], force = false) {
    await Promise.all(accountIds.map((id) => this.#refreshOne(id, force)));
  }

  #refreshOne(accountId: string, force: boolean) {
    const retryAt = this.#entries.get(accountId)?.retryAt;
    if (retryAt !== undefined && retryAt > this.#now) return Promise.resolve();
    if (!force && this.isFresh(accountId)) return Promise.resolve();
    const running = this.#reading.get(accountId);
    if (running) return running;
    const reading = this.#read(accountId).finally(() => this.#reading.delete(accountId));
    this.#reading.set(accountId, reading);
    return reading;
  }

  async #attempt(accountId: string): Promise<UsageRead> {
    try {
      return await this.#options.read(accountId);
    } catch (error) {
      return {
        ok: false,
        reason: 'failed',
        detail: `Could not read usage: ${describeError(error)}`,
        retryAfterMs: null,
      };
    }
  }

  async #read(accountId: string) {
    const result = await this.#attempt(accountId);
    const { retryAt: _retryAt, ...previous } = this.#entries.get(accountId) ?? createUnknownUsage();
    const now = this.#now;
    if (result.ok) {
      const found = result.windows.length > 0;
      const fastMode = result.fastMode ?? previous.fastMode;
      this.#store(accountId, {
        status: found ? 'ok' : 'unavailable',
        windows: result.windows,
        detail: found ? null : (this.#options.emptyDetail ?? NO_WINDOWS),
        checkedAt: now,
        source: 'read',
        ...(fastMode ? { fastMode } : {}),
      });
      return;
    }
    this.#store(accountId, {
      ...previous,
      status: previous.windows.length > 0 ? previous.status : 'unavailable',
      detail: result.detail,
      ...(result.reason === 'limited'
        ? { retryAt: now + Math.max(result.retryAfterMs ?? 0, LIMITED_BACKOFF_MS) }
        : {}),
    });
  }

  recordPush(accountId: string, notice: RateLimitNotice) {
    if (!notice.limit) return;
    const table = this.#options.windows ?? KEYED_WINDOWS;
    const id = table[notice.limit]?.id ?? resolveWindowId(notice.limit);
    const previous = this.#entries.get(accountId) ?? createUnknownUsage();
    const known = previous.windows.find((candidate) => candidate.id === id);
    const keyed = table[notice.limit];
    if (!known && !keyed) return;
    const usedPercent = resolvePushedPercent(notice) ?? known?.usedPercent ?? null;
    if (usedPercent === null) return;
    const window: UsageWindow = known
      ? { ...known, usedPercent, resetsAt: notice.resetsAt ?? known.resetsAt }
      : { ...(keyed as KeyedWindow), usedPercent, resetsAt: notice.resetsAt };
    const windows = known
      ? previous.windows.map((candidate) => (candidate.id === id ? window : candidate))
      : [...previous.windows, window];
    this.#store(accountId, {
      ...previous,
      status: 'ok',
      windows,
      detail: null,
      checkedAt: this.#now,
      source: 'push',
    });
  }
}
