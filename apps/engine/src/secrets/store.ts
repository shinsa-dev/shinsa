import { createHmac, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { DomainError, SECRET_REF_PATTERN } from '@shinsa/core';
import { writeJsonFile } from '../config/index.ts';
import { describeError, log } from '../log/index.ts';

const SECRET_REF_TTL_MS = 24 * 60 * 60 * 1000;

const REF_PREFIX = 'secret-ref:';

interface StoredRef {
  value: string;
  taskId: string;
  savedAt: number;
}

export interface WebhookCredentials {
  token: string;
  secret: string | null;
}

export type McpCredentials = Record<string, unknown>;

interface SecretFile {
  version: 1;
  salt: string;
  refs: Record<string, StoredRef>;
  hooks: Record<string, WebhookCredentials>;
  mcp: Record<string, McpCredentials>;
}

export interface SecretStoreOptions {
  now?: () => number;
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRefs(value: unknown) {
  if (!isFields(value)) return {};
  const refs: Record<string, StoredRef> = {};
  for (const [ref, entry] of Object.entries(value)) {
    if (!isFields(entry)) continue;
    if (
      typeof entry.value !== 'string' ||
      typeof entry.taskId !== 'string' ||
      typeof entry.savedAt !== 'number'
    )
      continue;
    refs[ref] = { value: entry.value, taskId: entry.taskId, savedAt: entry.savedAt };
  }
  return refs;
}

function readHooks(value: unknown) {
  if (!isFields(value)) return {};
  const hooks: Record<string, WebhookCredentials> = {};
  for (const [scheduleId, entry] of Object.entries(value)) {
    if (!isFields(entry) || typeof entry.token !== 'string') continue;
    hooks[scheduleId] = {
      token: entry.token,
      secret: typeof entry.secret === 'string' ? entry.secret : null,
    };
  }
  return hooks;
}

function readMcp(value: unknown) {
  if (!isFields(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Fields] => isFields(entry[1]))
  );
}

function createFile(): SecretFile {
  return { version: 1, salt: randomBytes(32).toString('hex'), refs: {}, hooks: {}, mcp: {} };
}

function replaceUnreadable(path: string, problem: string): SecretFile {
  const copy = `${path}.unreadable-${Date.now()}`;
  copyFileSync(path, copy);
  log.warn('[Secrets] The secret store could not be read; it was kept aside and an empty one started', {
    path,
    copy,
    problem,
  });
  return createFile();
}

function readFile(path: string): SecretFile {
  if (!existsSync(path)) return createFile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return replaceUnreadable(path, describeError(error));
  }
  if (!isFields(parsed) || typeof parsed.salt !== 'string' || parsed.salt.length === 0) {
    return replaceUnreadable(path, 'It has no salt.');
  }
  return {
    version: 1,
    salt: parsed.salt,
    refs: readRefs(parsed.refs),
    hooks: readHooks(parsed.hooks),
    mcp: readMcp(parsed.mcp),
  };
}

export class SecretStore {
  readonly #path: string;
  readonly #now: () => number;
  #file: SecretFile;

  constructor(path: string, options: SecretStoreOptions = {}) {
    this.#path = path;
    this.#now = options.now ?? Date.now;
    this.#file = readFile(path);
  }

  #write(next: SecretFile) {
    writeJsonFile(this.#path, next);
    this.#file = next;
  }

  resolveRef(gateId: string) {
    return `${REF_PREFIX}${createHmac('sha256', this.#file.salt).update(gateId).digest('hex').slice(0, 32)}`;
  }

  writeRef(gateId: string, taskId: string, value: string) {
    const ref = this.resolveRef(gateId);
    this.#write({
      ...this.#file,
      refs: { ...this.#file.refs, [ref]: { value, taskId, savedAt: this.#now() } },
    });
    return ref;
  }

  hasRef(ref: string) {
    return ref in this.#file.refs;
  }

  removeRef(ref: string, taskId: string) {
    if (!SECRET_REF_PATTERN.test(ref)) {
      throw new DomainError(
        'secret_ref_invalid',
        'That is not a secret ref. Use the secret-ref:… request_secret returned.'
      );
    }
    const stored = this.#file.refs[ref];
    if (!stored || stored.taskId !== taskId) {
      throw new DomainError(
        'secret_ref_unavailable',
        'That secret ref has been used or belongs to another task. Ask for the secret again with request_secret.'
      );
    }
    const { [ref]: _removed, ...refs } = this.#file.refs;
    this.#write({ ...this.#file, refs });
    if (this.#now() - stored.savedAt > SECRET_REF_TTL_MS) {
      throw new DomainError(
        'secret_ref_expired',
        'That secret ref expired. Ask for the secret again with request_secret.'
      );
    }
    return stored.value;
  }

  removeExpiredRefs() {
    const now = this.#now();
    const live = Object.entries(this.#file.refs).filter(
      ([, stored]) => now - stored.savedAt <= SECRET_REF_TTL_MS
    );
    if (live.length === Object.keys(this.#file.refs).length) return;
    this.#write({ ...this.#file, refs: Object.fromEntries(live) });
  }

  selectHook(scheduleId: string): WebhookCredentials | null {
    return this.#file.hooks[scheduleId] ?? null;
  }

  upsertHook(scheduleId: string): WebhookCredentials {
    const existing = this.selectHook(scheduleId);
    if (existing) return existing;
    const created = { token: randomBytes(24).toString('base64url'), secret: null };
    this.#write({ ...this.#file, hooks: { ...this.#file.hooks, [scheduleId]: created } });
    return created;
  }

  writeHookSecret(scheduleId: string, secret: string | null) {
    const hook = { ...this.upsertHook(scheduleId), secret };
    this.#write({ ...this.#file, hooks: { ...this.#file.hooks, [scheduleId]: hook } });
  }

  pruneHooks(live: ReadonlySet<string>) {
    const kept = Object.entries(this.#file.hooks).filter(([scheduleId]) => live.has(scheduleId));
    if (kept.length === Object.keys(this.#file.hooks).length) return;
    this.#write({ ...this.#file, hooks: Object.fromEntries(kept) });
  }

  selectMcpCredentials(serverId: string): McpCredentials {
    return this.#file.mcp[serverId] ?? {};
  }

  updateMcpCredentials(serverId: string, patch: McpCredentials) {
    const next = { ...this.selectMcpCredentials(serverId), ...patch };
    this.#write({ ...this.#file, mcp: { ...this.#file.mcp, [serverId]: next } });
  }

  removeMcpCredentials(serverId: string) {
    if (!(serverId in this.#file.mcp)) return;
    const { [serverId]: _removed, ...mcp } = this.#file.mcp;
    this.#write({ ...this.#file, mcp });
  }
}
