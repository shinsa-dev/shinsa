import { type AgentModel, resolveModelLabel } from '@shinsa/core';
import type { CodexParams } from '../client/schema.ts';
import { readText } from '../params.ts';

export function resolveCodexModels(rows: unknown[]): AgentModel[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as CodexParams;
    const id = readText(record, 'model') || readText(record, 'id');
    if (!id || record.hidden === true) return [];
    return [
      {
        id,
        label: readText(record, 'displayName') || resolveModelLabel(id),
        description: readText(record, 'description'),
      },
    ];
  });
}
