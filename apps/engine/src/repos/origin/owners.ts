import type { Repo, ShinsaState } from '@shinsa/core';
import { GITHUB_REMOTE_OWNER } from './schema.ts';

export function listProjectOwners(state: ShinsaState, repo: Pick<Repo, 'id' | 'projectId'>) {
  if (!repo.projectId) return [];
  const counts = new Map<string, number>();
  for (const other of Object.values(state.repos)) {
    if (other.id === repo.id || other.projectId !== repo.projectId) continue;
    const owner = other.remote?.match(GITHUB_REMOTE_OWNER)?.[1]?.toLowerCase();
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([owner]) => owner);
}
