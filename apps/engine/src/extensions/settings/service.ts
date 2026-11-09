import { join } from 'node:path';
import type { ContextOptimizer, McpServerStatus } from '@shinsa/core';
import { Context, Effect, Layer, SynchronizedRef } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { EXTENSIONS_FILE, type ExtensionsSettings, type ServerChoice, type StoredServer } from '../schema.ts';
import { ExtensionFiles } from '../store/service.ts';

export class ExtensionStore extends Context.Service<
  ExtensionStore,
  {
    readonly path: string;
    readonly read: Effect.Effect<ExtensionsSettings>;
    readonly recordSeen: (keys: readonly string[], at: number) => Effect.Effect<void>;
    readonly updateOptimizer: (patch: Partial<ContextOptimizer>) => Effect.Effect<void>;
    readonly upsertServer: (server: StoredServer) => Effect.Effect<void>;
    readonly removeServer: (id: string) => Effect.Effect<void>;
    readonly updateChoice: (id: string, patch: ServerChoice) => Effect.Effect<void>;
    readonly updateSkill: (id: string, enabled: boolean) => Effect.Effect<void>;
    readonly updatePlugin: (id: string, enabled: boolean) => Effect.Effect<void>;
    readonly writeStatus: (id: string, status: McpServerStatus | null) => Effect.Effect<void>;
  }
>()('shinsa/engine/extensions/settings/ExtensionStore') {
  static readonly layer = Layer.effect(
    ExtensionStore,
    Effect.gen(function* () {
      const files = yield* ExtensionFiles;
      const path = join((yield* EngineConfig).home, EXTENSIONS_FILE);
      const file = yield* SynchronizedRef.make(yield* files.readSettings(path));

      const write = Effect.fn('ExtensionStore.write')(function* (
        change: (current: ExtensionsSettings) => ExtensionsSettings | null
      ) {
        yield* SynchronizedRef.updateEffect(file, (current) => {
          const next = change(current);
          return next === null ? Effect.succeed(current) : Effect.as(files.writeSettings(path, next), next);
        });
      });

      return ExtensionStore.of({
        path,
        read: SynchronizedRef.get(file),
        recordSeen: (keys, at) =>
          write((current) => {
            const fresh = keys.filter((key) => current.seen[key] === undefined);
            if (fresh.length === 0) return null;
            return {
              ...current,
              seen: { ...current.seen, ...Object.fromEntries(fresh.map((key) => [key, at])) },
            };
          }),
        updateOptimizer: (patch) =>
          write((current) => ({ ...current, optimizer: { ...current.optimizer, ...patch } })),
        upsertServer: (server) =>
          write((current) => {
            const servers = current.servers.some((entry) => entry.id === server.id)
              ? current.servers.map((entry) => (entry.id === server.id ? server : entry))
              : [...current.servers, server];
            return { ...current, servers };
          }),
        removeServer: (id) =>
          write((current) => {
            const { [id]: _choice, ...choices } = current.choices;
            const { [id]: _status, ...statuses } = current.statuses;
            return {
              ...current,
              servers: current.servers.filter((entry) => entry.id !== id),
              choices,
              statuses,
            };
          }),
        updateChoice: (id, patch) =>
          write((current) => ({
            ...current,
            choices: { ...current.choices, [id]: { ...current.choices[id], ...patch } },
          })),
        updateSkill: (id, enabled) =>
          write((current) => ({ ...current, skills: { ...current.skills, [id]: enabled } })),
        updatePlugin: (id, enabled) =>
          write((current) => ({ ...current, plugins: { ...current.plugins, [id]: enabled } })),
        writeStatus: (id, status) =>
          write((current) => {
            const { [id]: _status, ...statuses } = current.statuses;
            return { ...current, statuses: status ? { ...statuses, [id]: status } : statuses };
          }),
      });
    })
  );
}
