import { PROTOCOL_LIMITS } from '@shinsa/core';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

export function limitedText(description: string, maxLength: number) {
  return { type: 'string', description: `${description} At most ${maxLength} characters.`, maxLength };
}

export function textList(description: string, maxItems: number, maxLength: number) {
  return { type: 'array', description, maxItems, items: { type: 'string', maxLength } };
}

export function limitedPath(description: string) {
  return { type: 'string', description, maxLength: PROTOCOL_LIMITS.path };
}
