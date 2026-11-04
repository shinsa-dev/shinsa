import { Effect } from 'effect';
import type { LoginLookup } from './registry/schema.ts';

export const resolveOwnerProjectName = Effect.fn('RepoRegistry.resolveProjectName')(function* (
  remote: string | null,
  login: LoginLookup | null
) {
  const owner = remote?.split('/')[1]?.toLowerCase();
  if (!owner) return 'Local';
  if (login && owner === (yield* login)) return 'Personal';
  return owner
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
});
