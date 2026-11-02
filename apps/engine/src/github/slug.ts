import type { Repo } from '@shinsa/core';
import type { RepoSlug } from './schema.ts';

export function resolveRepoSlug(repo: Repo): RepoSlug | null {
  const [owner, name] = repo.remote?.split('/').slice(-2) ?? [];
  if (!owner || !name) return null;
  return { owner, name };
}
