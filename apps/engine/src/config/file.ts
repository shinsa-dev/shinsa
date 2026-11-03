import { keepJsonFileAside, writeJsonFile } from '../files/index.ts';
import { log } from '../log/index.ts';
import { readMachineConfig } from './machine/index.ts';
import type { MachineConfig } from './machine/schema.ts';

export class ConfigStore {
  readonly path: string;
  #config: MachineConfig;

  constructor(path: string, read = readMachineConfig(path)) {
    this.path = path;
    const copy = read.unreadable ? keepJsonFileAside(path) : null;
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
