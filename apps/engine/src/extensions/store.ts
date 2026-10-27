import { existsSync, readFileSync } from 'node:fs';
import {
  type ContextOptimizer,
  createContextOptimizer,
  type ExtensionScope,
  type McpServerStatus,
  type McpToolInfo,
  OPTIMIZER_LIMITS,
} from '@shinsa/core';
import { writeJsonFile } from '../config/index.ts';
import { describeError, log } from '../log/index.ts';
import { isFields, type McpDefinition, parseMcpEntry, readTrimmedText } from './definitions.ts';

export interface StoredServer {
  id: string;
  name: string;
  definition: McpDefinition;
  enabled: boolean;
  scope: ExtensionScope;
}

interface ServerChoice {
  enabled?: boolean;
  scope?: ExtensionScope;
}

interface ExtensionsFile {
  version: 1;
  servers: StoredServer[];
  choices: Record<string, ServerChoice>;
  skills: Record<string, boolean>;
  plugins: Record<string, boolean>;
  statuses: Record<string, McpServerStatus>;
  optimizer: ContextOptimizer;
  seen: Record<string, number>;
}

const STATES = new Set<McpServerStatus['state']>(['connected', 'needs_sign_in', 'failing', 'unchecked']);

function createFile(): ExtensionsFile {
  return {
    version: 1,
    servers: [],
    choices: {},
    skills: {},
    plugins: {},
    statuses: {},
    optimizer: createContextOptimizer(),
    seen: {},
  };
}

function readSwitches(value: unknown) {
  if (!isFields(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
  );
}

function readTool(value: unknown): McpToolInfo[] {
  if (!isFields(value) || typeof value.name !== 'string') return [];
  return [
    { name: value.name, description: typeof value.description === 'string' ? value.description : null },
  ];
}

function readStatus(value: unknown): McpServerStatus | null {
  if (!isFields(value) || !STATES.has(value.state as McpServerStatus['state'])) return null;
  return {
    state: value.state as McpServerStatus['state'],
    error: typeof value.error === 'string' ? value.error : null,
    checkedAt: typeof value.checkedAt === 'number' ? value.checkedAt : null,
    tools: Array.isArray(value.tools) ? value.tools.flatMap(readTool) : [],
    tokens: typeof value.tokens === 'number' ? value.tokens : null,
  };
}

export function isOptimizerDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= OPTIMIZER_LIMITS.minDays &&
    value <= OPTIMIZER_LIMITS.maxDays
  );
}

function readOptimizer(value: unknown): ContextOptimizer {
  const optimizer = createContextOptimizer();
  if (!isFields(value)) return optimizer;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : optimizer.enabled,
    days: isOptimizerDays(value.days) ? value.days : optimizer.days,
    skills: typeof value.skills === 'boolean' ? value.skills : optimizer.skills,
  };
}

function readSeen(value: unknown) {
  if (!isFields(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  );
}

function readStatuses(value: unknown) {
  if (!isFields(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, entry]) => {
      const status = readStatus(entry);
      return status ? [[id, status]] : [];
    })
  );
}

export function parseScope(value: unknown): ExtensionScope | null {
  if (!isFields(value)) return null;
  if (value.kind === 'everywhere') return { kind: 'everywhere' };
  if (value.kind === 'project' && typeof value.project === 'string' && value.project) {
    return { kind: 'project', project: value.project };
  }
  if (value.kind === 'repo' && typeof value.path === 'string' && value.path) {
    return { kind: 'repo', path: value.path };
  }
  return null;
}

function readStoredServer(value: unknown): StoredServer | null {
  if (!isFields(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  const definition = parseMcpEntry(value.definition);
  if (!definition || !isFields(value.definition)) return null;
  return {
    id: value.id,
    name: value.name,
    definition: {
      ...definition,
      bearerTokenEnv: definition.bearerTokenEnv ?? readTrimmedText(value.definition.bearerTokenEnv),
    },
    enabled: value.enabled !== false,
    scope: parseScope(value.scope) ?? { kind: 'everywhere' },
  };
}

function readChoice(value: unknown): ServerChoice | null {
  if (!isFields(value)) return null;
  const scope = parseScope(value.scope);
  return {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(scope ? { scope } : {}),
  };
}

function readFile(path: string): ExtensionsFile {
  if (!existsSync(path)) return createFile();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isFields(parsed)) return createFile();
    const servers = Array.isArray(parsed.servers)
      ? parsed.servers.flatMap((s) => readStoredServer(s) ?? [])
      : [];
    const choices = isFields(parsed.choices)
      ? Object.fromEntries(
          Object.entries(parsed.choices).flatMap(([id, value]) => {
            const choice = readChoice(value);
            return choice ? [[id, choice]] : [];
          })
        )
      : {};
    return {
      version: 1,
      servers,
      choices,
      skills: readSwitches(parsed.skills),
      plugins: readSwitches(parsed.plugins),
      statuses: readStatuses(parsed.statuses),
      optimizer: readOptimizer(parsed.optimizer),
      seen: readSeen(parsed.seen),
    };
  } catch (error) {
    log.warn('[Extensions] extensions.json could not be read; starting from none', {
      path,
      error: describeError(error),
    });
    return createFile();
  }
}

export class ExtensionStore {
  readonly path: string;
  #file: ExtensionsFile;

  constructor(path: string) {
    this.path = path;
    this.#file = readFile(path);
  }

  #write(next: ExtensionsFile) {
    writeJsonFile(this.path, next);
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
