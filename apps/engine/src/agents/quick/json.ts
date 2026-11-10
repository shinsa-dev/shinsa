import { Option, Schema } from 'effect';

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function parseCandidate(candidate: string | undefined) {
  return candidate ? Option.getOrNull(decodeJson(candidate)) : null;
}

export function parseJsonObject<T>(text: string | null): T | null {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text)?.[1];
  const parsed = parseCandidate(fenced) ?? parseCandidate(/\{[\s\S]*\}/.exec(text)?.[0]);
  return parsed as T | null;
}

export function parseObject<T>(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as T) : null;
}
