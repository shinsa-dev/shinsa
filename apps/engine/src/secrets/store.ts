import { createHmac, randomBytes } from 'node:crypto';
import { DomainError, SECRET_REF_PATTERN } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { SecretFiles } from './files/service.ts';
import {
  HOOK_TOKEN_BYTES,
  type McpCredentials,
  REF_LENGTH,
  REF_PREFIX,
  SECRET_REF_TTL_MS,
  type SecretFile,
  type WebhookCredentials,
} from './schema.ts';

export type { McpCredentials, WebhookCredentials } from './schema.ts';

export interface SecretStoreOptions {
  now?: () => number;
}

export class SecretStore {
  readonly #path: string;
  readonly #now: () => number;
  #file: SecretFile;

  constructor(path: string, options: SecretStoreOptions = {}) {
    this.#path = path;
    this.#now = options.now ?? Date.now;
    this.#file = edgeRuntime.runSync(SecretFiles.use((files) => files.read(path)));
  }

  #write(next: SecretFile) {
    edgeRuntime.runSync(SecretFiles.use((files) => files.write(this.#path, next)));
    this.#file = next;
  }

  resolveRef(gateId: string) {
    return `${REF_PREFIX}${createHmac('sha256', this.#file.salt).update(gateId).digest('hex').slice(0, REF_LENGTH)}`;
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
      throw new DomainError({
        code: 'secret_ref_invalid',
        message: 'That is not a secret ref. Use the secret-ref:… request_secret returned.',
      });
    }
    const stored = this.#file.refs[ref];
    if (!stored || stored.taskId !== taskId) {
      throw new DomainError({
        code: 'secret_ref_unavailable',
        message:
          'That secret ref has been used or belongs to another task. Ask for the secret again with request_secret.',
      });
    }
    const { [ref]: _removed, ...refs } = this.#file.refs;
    this.#write({ ...this.#file, refs });
    if (this.#now() - stored.savedAt > SECRET_REF_TTL_MS) {
      throw new DomainError({
        code: 'secret_ref_expired',
        message: 'That secret ref expired. Ask for the secret again with request_secret.',
      });
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
    const created = { token: randomBytes(HOOK_TOKEN_BYTES).toString('base64url'), secret: null };
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
