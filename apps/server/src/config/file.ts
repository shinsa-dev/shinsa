import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describeError, log } from '../log/index.ts';

export interface MachineConfig {
  version: 1;
  roots: string[];
  onboardedAt: number | null;
  port: number | null;
  hostname: string | null;
  editor: string | null;
  terminal: string | null;
}

export interface MachineConfigRead {
  config: MachineConfig;
  problems: string[];
  unreadable: boolean;
}

type Fields = Record<string, unknown>;

export function createMachineConfig(): MachineConfig {
  return {
    version: 1,
    roots: [],
    onboardedAt: null,
    port: null,
    hostname: null,
    editor: null,
    terminal: null,
  };
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function readText(fields: Fields, key: keyof MachineConfig, problems: string[]) {
  const value = fields[key];
  if (value === undefined || value === null) return null;
  if (isText(value)) return value.trim();
  problems.push(`${key} must be text; it was ignored.`);
  return null;
}

function readRoots(fields: Fields, problems: string[]) {
  const value = fields.roots;
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.every(isText)) return [...new Set(value.map((root) => root.trim()))];
  problems.push('roots must be a list of folders; it was ignored.');
  return [];
}

function readPort(fields: Fields, problems: string[]) {
  const value = fields.port;
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65_535) return value;
  problems.push('port must be a port number; it was ignored.');
  return null;
}

function readTime(fields: Fields, key: 'onboardedAt', problems: string[]) {
  const value = fields[key];
  if (value === undefined || value === null) return null;
  if (isTime(value)) return value;
  problems.push(`${key} must be a time; it was ignored.`);
  return null;
}

export function parseMachineConfig(value: unknown): MachineConfigRead {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { config: createMachineConfig(), problems: ['The file is not a JSON object.'], unreadable: false };
  }
  const fields = value as Fields;
  const problems: string[] = [];
  const config: MachineConfig = {
    version: 1,
    roots: readRoots(fields, problems),
    onboardedAt: readTime(fields, 'onboardedAt', problems),
    port: readPort(fields, problems),
    hostname: readText(fields, 'hostname', problems),
    editor: readText(fields, 'editor', problems),
    terminal: readText(fields, 'terminal', problems),
  };
  return { config, problems, unreadable: false };
}

function keepUnreadable(path: string) {
  const copy = `${path}.unreadable-${Date.now()}`;
  copyFileSync(path, copy);
  return copy;
}

export function readMachineConfig(path: string): MachineConfigRead {
  if (!existsSync(path)) return { config: createMachineConfig(), problems: [], unreadable: false };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      config: createMachineConfig(),
      problems: [`The file is not valid JSON (${describeError(error)}).`],
      unreadable: true,
    };
  }
  return parseMachineConfig(value);
}

export function writeJsonFile(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.writing-${process.pid}`;
  writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(staging, path);
}

export class ConfigStore {
  readonly path: string;
  #config: MachineConfig;

  constructor(path: string, read = readMachineConfig(path)) {
    this.path = path;
    const copy = read.unreadable ? keepUnreadable(path) : null;
    for (const problem of read.problems) {
      log.warn('[Config] Part of config.json was not used', { path, problem, ...(copy ? { copy } : {}) });
    }
    this.#config = read.config;
  }

  get config(): MachineConfig {
    return this.#config;
  }

  update(patch: Partial<Omit<MachineConfig, 'version'>>) {
    const next = { ...this.#config, ...patch };
    writeJsonFile(this.path, next);
    this.#config = next;
    return next;
  }
}
