import type { CodexParams } from './client/schema.ts';

export function readRecord(value: unknown): CodexParams {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as CodexParams) : {};
}

export function readText(record: CodexParams, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}
