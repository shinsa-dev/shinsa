import { copyFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { log } from '../log/index.ts';
import { readMachineConfig } from './machine.ts';
import type { MachineConfig } from './schema.ts';

export { createMachineConfig, parseMachineConfig, readMachineConfig } from './machine.ts';
export type { MachineConfig } from './schema.ts';

function keepUnreadable(path: string) {
  const copy = `${path}.unreadable-${Date.now()}`;
  copyFileSync(path, copy);
  return copy;
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
