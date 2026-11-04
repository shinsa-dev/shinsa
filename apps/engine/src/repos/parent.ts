import { dirname } from 'node:path';
import type { ShinsaState } from '@shinsa/core';

export function resolveNewRepoParent(state: Pick<ShinsaState, 'projects' | 'repos'>, projectId: string) {
  const folder = state.projects[projectId]?.folders[0];
  if (folder) return folder;
  const sibling = Object.values(state.repos).find((repo) => repo.projectId === projectId);
  return sibling ? dirname(sibling.path) : null;
}
