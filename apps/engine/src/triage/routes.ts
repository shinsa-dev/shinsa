import type { MessageKind, MessageRoute } from '@shinsa/core';
import type { MessageClass } from './schema.ts';

function isNewWork(kind: MessageKind) {
  return kind === 'new_round' || kind === 'separate_task';
}

export function resolveMessageRoute(found: MessageClass | null): MessageRoute {
  if (!found) return {};
  return {
    kind: found.kind,
    ...(found.title ? { title: found.title } : {}),
    ...(found.why ? { why: found.why } : {}),
    ...(found.shape && isNewWork(found.kind) ? { shape: found.shape } : {}),
  };
}
