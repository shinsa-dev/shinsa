import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { type AgentModel, resolveModelFamily, resolveModelLabel } from '@shinsa/core';

export function resolveModels(rows: ModelInfo[]): AgentModel[] {
  const families = new Map<string, AgentModel>();
  for (const row of rows) {
    const wireId = row.resolvedModel ?? row.value;
    const family = resolveModelFamily(wireId);
    if (family === 'default' || families.has(family)) continue;
    families.set(family, { id: family, label: resolveModelLabel(wireId), description: row.description });
  }
  return [...families.values()];
}
