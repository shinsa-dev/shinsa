import type { ServiceDefinition, TerminalInfo } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { StoredService, StoredTerminal } from './schema.ts';
import { TerminalFiles } from './store/service.ts';

const decodeTerminal = Schema.decodeUnknownOption(StoredTerminal);

const decodeService = Schema.decodeUnknownOption(StoredService);

export function parseStoredTerminal(value: unknown): TerminalInfo | null {
  return Option.getOrNull(decodeTerminal(value));
}

export function parseStoredService(value: unknown): ServiceDefinition | null {
  return Option.getOrNull(decodeService(value));
}

export class TerminalStore {
  readonly #dataDir: string;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  readTerminals(): TerminalInfo[] {
    return edgeRuntime.runSync(TerminalFiles.use((files) => files.readTerminals(this.#dataDir)));
  }

  writeTerminals(terminals: TerminalInfo[]) {
    edgeRuntime.runSync(TerminalFiles.use((files) => files.writeTerminals(this.#dataDir, terminals)));
  }

  readServices(): ServiceDefinition[] {
    return edgeRuntime.runSync(TerminalFiles.use((files) => files.readServices(this.#dataDir)));
  }

  writeServices(services: ServiceDefinition[]) {
    edgeRuntime.runSync(TerminalFiles.use((files) => files.writeServices(this.#dataDir, services)));
  }

  readScreen(id: string) {
    return edgeRuntime.runSync(TerminalFiles.use((files) => files.readScreen(this.#dataDir, id)));
  }

  writeScreen(id: string, screen: string) {
    edgeRuntime.runSync(TerminalFiles.use((files) => files.writeScreen(this.#dataDir, id, screen)));
  }

  removeScreen(id: string) {
    edgeRuntime.runSync(TerminalFiles.use((files) => files.removeScreen(this.#dataDir, id)));
  }
}
