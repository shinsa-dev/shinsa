import { createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DomainError, SECRET_REF_PATTERN } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Ref } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { SecretFiles } from '../files/service.ts';
import {
  HOOK_TOKEN_BYTES,
  type McpCredentials,
  REF_LENGTH,
  REF_PREFIX,
  SECRET_REF_TTL_MS,
  SECRETS_FILE,
  type SecretFile,
  type WebhookCredentials,
} from '../schema.ts';

export class SecretStore extends Context.Service<
  SecretStore,
  {
    resolveRef(gateId: string): Effect.Effect<string>;
    writeRef(gateId: string, taskId: string, value: string): Effect.Effect<string>;
    hasRef(ref: string): Effect.Effect<boolean>;
    removeRef(ref: string, taskId: string): Effect.Effect<string, DomainError>;
    readonly removeExpiredRefs: Effect.Effect<void>;
    selectHook(scheduleId: string): Effect.Effect<WebhookCredentials | null>;
    upsertHook(scheduleId: string): Effect.Effect<WebhookCredentials>;
    writeHookSecret(scheduleId: string, secret: string | null): Effect.Effect<void>;
    pruneHooks(live: ReadonlySet<string>): Effect.Effect<void>;
    selectMcpCredentials(serverId: string): Effect.Effect<McpCredentials>;
    updateMcpCredentials(serverId: string, patch: McpCredentials): Effect.Effect<void>;
    removeMcpCredentials(serverId: string): Effect.Effect<void>;
  }
>()('shinsa/engine/secrets/store/SecretStore') {
  static readonly layer = Layer.effect(
    SecretStore,
    Effect.gen(function* () {
      const path = join((yield* EngineConfig).dataDir, SECRETS_FILE);
      const files = yield* SecretFiles;
      const clock = yield* Clock.Clock;
      const current = yield* Ref.make(yield* files.read(path));
      const file = Ref.get(current);

      const write = Effect.fn('SecretStore.write')(function* (next: SecretFile) {
        yield* files.write(path, next);
        yield* Ref.set(current, next);
      });

      const resolveRef = Effect.fn('SecretStore.resolveRef')(function* (gateId: string) {
        const { salt } = yield* file;
        return `${REF_PREFIX}${createHmac('sha256', salt).update(gateId).digest('hex').slice(0, REF_LENGTH)}`;
      });

      const writeRef = Effect.fn('SecretStore.writeRef')(function* (
        gateId: string,
        taskId: string,
        value: string
      ) {
        const ref = yield* resolveRef(gateId);
        const savedAt = yield* clock.currentTimeMillis;
        const known = yield* file;
        yield* write({ ...known, refs: { ...known.refs, [ref]: { value, taskId, savedAt } } });
        return ref;
      });

      const hasRef = (ref: string) => Effect.map(file, (known) => ref in known.refs);

      const removeRef = Effect.fn('SecretStore.removeRef')(function* (ref: string, taskId: string) {
        if (!SECRET_REF_PATTERN.test(ref)) {
          return yield* new DomainError({
            code: 'secret_ref_invalid',
            message: 'That is not a secret ref. Use the secret-ref:… request_secret returned.',
          });
        }
        const known = yield* file;
        const stored = known.refs[ref];
        if (!stored || stored.taskId !== taskId) {
          return yield* new DomainError({
            code: 'secret_ref_unavailable',
            message:
              'That secret ref has been used or belongs to another task. Ask for the secret again with request_secret.',
          });
        }
        const { [ref]: _removed, ...refs } = known.refs;
        yield* write({ ...known, refs });
        if ((yield* clock.currentTimeMillis) - stored.savedAt > SECRET_REF_TTL_MS) {
          return yield* new DomainError({
            code: 'secret_ref_expired',
            message: 'That secret ref expired. Ask for the secret again with request_secret.',
          });
        }
        return stored.value;
      });

      const removeExpiredRefs = Effect.gen(function* () {
        const now = yield* clock.currentTimeMillis;
        const known = yield* file;
        const live = Object.entries(known.refs).filter(
          ([, stored]) => now - stored.savedAt <= SECRET_REF_TTL_MS
        );
        if (live.length === Object.keys(known.refs).length) return;
        yield* write({ ...known, refs: Object.fromEntries(live) });
      }).pipe(Effect.withSpan('SecretStore.removeExpiredRefs'));

      const selectHook = (scheduleId: string) => Effect.map(file, (known) => known.hooks[scheduleId] ?? null);

      const upsertHook = Effect.fn('SecretStore.upsertHook')(function* (scheduleId: string) {
        const existing = yield* selectHook(scheduleId);
        if (existing) return existing;
        const created = { token: randomBytes(HOOK_TOKEN_BYTES).toString('base64url'), secret: null };
        const known = yield* file;
        yield* write({ ...known, hooks: { ...known.hooks, [scheduleId]: created } });
        return created;
      });

      const writeHookSecret = Effect.fn('SecretStore.writeHookSecret')(function* (
        scheduleId: string,
        secret: string | null
      ) {
        const hook = { ...(yield* upsertHook(scheduleId)), secret };
        const known = yield* file;
        yield* write({ ...known, hooks: { ...known.hooks, [scheduleId]: hook } });
      });

      const pruneHooks = Effect.fn('SecretStore.pruneHooks')(function* (live: ReadonlySet<string>) {
        const known = yield* file;
        const kept = Object.entries(known.hooks).filter(([scheduleId]) => live.has(scheduleId));
        if (kept.length === Object.keys(known.hooks).length) return;
        yield* write({ ...known, hooks: Object.fromEntries(kept) });
      });

      const selectMcpCredentials = (serverId: string) =>
        Effect.map(file, (known): McpCredentials => known.mcp[serverId] ?? {});

      const updateMcpCredentials = Effect.fn('SecretStore.updateMcpCredentials')(function* (
        serverId: string,
        patch: McpCredentials
      ) {
        const next = { ...(yield* selectMcpCredentials(serverId)), ...patch };
        const known = yield* file;
        yield* write({ ...known, mcp: { ...known.mcp, [serverId]: next } });
      });

      const removeMcpCredentials = Effect.fn('SecretStore.removeMcpCredentials')(function* (
        serverId: string
      ) {
        const known = yield* file;
        if (!(serverId in known.mcp)) return;
        const { [serverId]: _removed, ...mcp } = known.mcp;
        yield* write({ ...known, mcp });
      });

      return SecretStore.of({
        resolveRef,
        writeRef,
        hasRef,
        removeRef,
        removeExpiredRefs,
        selectHook,
        upsertHook,
        writeHookSecret,
        pruneHooks,
        selectMcpCredentials,
        updateMcpCredentials,
        removeMcpCredentials,
      });
    })
  );
}
