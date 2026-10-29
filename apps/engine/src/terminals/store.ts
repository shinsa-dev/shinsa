import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isServiceEnvKey,
  isServicePreviewUrl,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceDefinition,
  type TerminalInfo,
} from '@shinsa/core';
import { writeJsonFile } from '../config/file.ts';
import { describeError, log } from '../log/index.ts';

interface StoredTerminals {
  terminals: TerminalInfo[];
}

interface StoredServices {
  services: ServiceDefinition[];
}

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

const STATUSES = new Set(['running', 'exited', 'stopped']);

const PLACES = new Set(['repository', 'folder', 'worktree']);

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isPortOrNull(value: unknown): value is number | null {
  return (
    value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536)
  );
}

export function parseStoredTerminal(value: unknown): TerminalInfo | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  if (!(isText(fields.id) && ID_PATTERN.test(fields.id) && isText(fields.projectId) && isText(fields.cwd)))
    return null;
  if (!(STATUSES.has(fields.status as string) && PLACES.has(fields.place as string))) return null;
  if (!(isTextOrNull(fields.name) && isTextOrNull(fields.title) && isTextOrNull(fields.taskId))) return null;
  const serviceId = fields.serviceId ?? null;
  const port = fields.port ?? null;
  if (!(isTextOrNull(serviceId) && isPortOrNull(port))) return null;
  if (
    !(
      typeof fields.startedAt === 'number' &&
      isNumberOrNull(fields.endedAt) &&
      isNumberOrNull(fields.exitCode)
    )
  )
    return null;
  return { ...fields, serviceId, port } as unknown as TerminalInfo;
}

function isEnv(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= SERVICE_LIMITS.envKeys &&
    entries.every(
      ([key, each]) => isServiceEnvKey(key) && isText(each) && each.length <= SERVICE_LIMITS.envValue
    )
  );
}

export function parseStoredService(value: unknown): ServiceDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  if (!(isText(fields.id) && ID_PATTERN.test(fields.id) && isText(fields.projectId))) return null;
  if (!(isText(fields.name) && fields.name.length > 0 && isText(fields.cwd) && isText(fields.command)))
    return null;
  if (!isEnv(fields.env)) return null;
  const previewUrl = fields.previewUrl ?? null;
  const portVariable = fields.portVariable ?? SERVICE_PORT_VARIABLE;
  if (!(previewUrl === null || (isText(previewUrl) && isServicePreviewUrl(previewUrl)))) return null;
  if (!(isText(portVariable) && isServiceEnvKey(portVariable))) return null;
  const { id, projectId, name, cwd, command, env } = fields;
  return { id, projectId, name, cwd, command, env, previewUrl, portVariable };
}

function readList<T>(path: string, field: string, parse: (value: unknown) => T | null, what: string): T[] {
  if (!existsSync(path)) return [];
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> | null;
    const items = Array.isArray(stored?.[field]) ? (stored[field] as unknown[]) : [];
    return items.map(parse).filter((item) => item !== null);
  } catch (error) {
    log.warn(`[Terminals] Could not read the saved ${what}`, { error: describeError(error) });
    return [];
  }
}

export class TerminalStore {
  readonly #dir: string;

  constructor(dataDir: string) {
    this.#dir = join(dataDir, 'terminals');
  }

  get #index() {
    return join(this.#dir, 'terminals.json');
  }

  #screen(id: string) {
    return join(this.#dir, `${id}.screen`);
  }

  get #services() {
    return join(this.#dir, 'services.json');
  }

  readTerminals(): TerminalInfo[] {
    return readList(this.#index, 'terminals', parseStoredTerminal, 'terminals');
  }

  writeTerminals(terminals: TerminalInfo[]) {
    writeJsonFile(this.#index, { terminals } satisfies StoredTerminals);
  }

  readServices(): ServiceDefinition[] {
    return readList(this.#services, 'services', parseStoredService, 'services');
  }

  writeServices(services: ServiceDefinition[]) {
    writeJsonFile(this.#services, { services } satisfies StoredServices);
  }

  readScreen(id: string) {
    try {
      return readFileSync(this.#screen(id), 'utf8');
    } catch {
      return null;
    }
  }

  writeScreen(id: string, screen: string) {
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(this.#screen(id), screen, { mode: 0o600 });
  }

  removeScreen(id: string) {
    rmSync(this.#screen(id), { force: true });
  }
}
