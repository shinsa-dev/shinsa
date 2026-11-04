import type { ServiceDefinition, TerminalInfo } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { StoredService, StoredTerminal } from './schema.ts';

const decodeTerminal = Schema.decodeUnknownOption(StoredTerminal);

const decodeService = Schema.decodeUnknownOption(StoredService);

export function parseStoredTerminal(value: unknown): TerminalInfo | null {
  return Option.getOrNull(decodeTerminal(value));
}

export function parseStoredService(value: unknown): ServiceDefinition | null {
  return Option.getOrNull(decodeService(value));
}
