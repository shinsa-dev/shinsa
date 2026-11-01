import type { UnreachedTeammate } from './shapes.ts';

interface DuplicateOriginal {
  handle?: string | null;
  title: string;
  owner?: string | null;
}

export function quoteDuplicateOriginal(original: DuplicateOriginal) {
  const owner = original.owner ? `@${original.owner}’s ` : '';
  const handle = original.handle ? `${original.handle} ` : '';
  return `${owner}${handle}“${original.title}”`;
}

export function resolveTeammateMachineLabel(machine: Pick<UnreachedTeammate, 'name' | 'owner'>) {
  return machine.owner ? `@${machine.owner}’s ${machine.name}` : machine.name;
}
