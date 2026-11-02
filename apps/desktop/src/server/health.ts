import { Option, Schema } from 'effect';
import { HealthAnswer, type ServerHealth } from './schema.ts';

const decodeHealth = Schema.decodeUnknownOption(HealthAnswer);

const decodeHealthText = Schema.decodeUnknownOption(Schema.fromJsonString(HealthAnswer));

export function parseHealth(value: unknown): ServerHealth | null {
  return Option.getOrNull(decodeHealth(value));
}

export function parseHealthText(text: string): ServerHealth | null {
  return Option.getOrNull(decodeHealthText(text));
}
