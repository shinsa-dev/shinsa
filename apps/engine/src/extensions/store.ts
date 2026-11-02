import type { ContextOptimizer, ExtensionScope, McpServerStatus } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  ExtensionScope as ScopeSchema,
  type ExtensionsSettings,
  OptimizerDays,
  type ServerChoice,
  type StoredServer,
} from './schema.ts';
import { ExtensionFiles } from './store/service.ts';

export type { StoredServer } from './schema.ts';

const decodeScope = Schema.decodeUnknownOption(ScopeSchema);

export const isOptimizerDays = Schema.is(OptimizerDays);

export function parseScope(value: unknown): ExtensionScope | null {
  return Option.getOrNull(decodeScope(value));
}

export class ExtensionStore {
  readonly path: string;
  #file: ExtensionsSettings;

  constructor(path: string) {
    this.path = path;
    this.#file = edgeRuntime.runSync(ExtensionFiles.use((files) => files.readSettings(path)));
  }

  #write(next: ExtensionsSettings) {
    edgeRuntime.runSync(ExtensionFiles.use((files) => files.writeSettings(this.path, next)));
    this.#file = next;
  }

  listServers() {
    return this.#file.servers;
  }

  selectServer(id: string) {
    return this.#file.servers.find((server) => server.id === id) ?? null;
  }

  selectChoice(id: string): ServerChoice {
    return this.#file.choices[id] ?? {};
  }

  selectSkill(id: string) {
    return this.#file.skills[id] ?? null;
  }

  selectPlugin(id: string) {
    return this.#file.plugins[id] ?? null;
  }

  selectStatus(id: string) {
    return this.#file.statuses[id] ?? null;
  }

  selectOptimizer() {
    return this.#file.optimizer;
  }

  hasSeen() {
    return Object.keys(this.#file.seen).length > 0;
  }

  selectSeen(key: string) {
    return this.#file.seen[key] ?? null;
  }

  recordSeen(keys: string[], at: number) {
    const fresh = keys.filter((key) => this.#file.seen[key] === undefined);
    if (fresh.length === 0) return;
    this.#write({
      ...this.#file,
      seen: { ...this.#file.seen, ...Object.fromEntries(fresh.map((key) => [key, at])) },
    });
  }

  updateOptimizer(patch: Partial<ContextOptimizer>) {
    this.#write({ ...this.#file, optimizer: { ...this.#file.optimizer, ...patch } });
  }

  upsertServer(server: StoredServer) {
    const servers = this.#file.servers.some((entry) => entry.id === server.id)
      ? this.#file.servers.map((entry) => (entry.id === server.id ? server : entry))
      : [...this.#file.servers, server];
    this.#write({ ...this.#file, servers });
  }

  removeServer(id: string) {
    const { [id]: _choice, ...choices } = this.#file.choices;
    const { [id]: _status, ...statuses } = this.#file.statuses;
    this.#write({
      ...this.#file,
      servers: this.#file.servers.filter((entry) => entry.id !== id),
      choices,
      statuses,
    });
  }

  updateChoice(id: string, patch: ServerChoice) {
    this.#write({
      ...this.#file,
      choices: { ...this.#file.choices, [id]: { ...this.selectChoice(id), ...patch } },
    });
  }

  updateSkill(id: string, enabled: boolean) {
    this.#write({ ...this.#file, skills: { ...this.#file.skills, [id]: enabled } });
  }

  updatePlugin(id: string, enabled: boolean) {
    this.#write({ ...this.#file, plugins: { ...this.#file.plugins, [id]: enabled } });
  }

  writeStatus(id: string, status: McpServerStatus | null) {
    const { [id]: _status, ...statuses } = this.#file.statuses;
    this.#write({ ...this.#file, statuses: status ? { ...statuses, [id]: status } : statuses });
  }
}
