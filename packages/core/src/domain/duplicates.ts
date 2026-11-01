import type { UnreachedTeammate } from './shapes.ts';
import type { TeammateOriginal, TeammateOwner } from './types.ts';

interface DuplicateOriginal {
  handle?: string | null;
  title: string;
  owner?: TeammateOwner | null;
}

export function resolveFirstName(person: Pick<TeammateOwner, 'login' | 'name'>) {
  return person.name?.trim().split(/\s+/)[0] || person.login;
}

export function quoteDuplicateOriginal(original: DuplicateOriginal) {
  const owner = original.owner ? `${resolveFirstName(original.owner)}’s ` : '';
  const handle = original.handle ? `${original.handle} ` : '';
  return `${owner}${handle}“${original.title}”`;
}

export function resolveTeammateMachineLabel(machine: Pick<UnreachedTeammate, 'name' | 'owner'>) {
  return machine.owner ? `${resolveFirstName(machine.owner)}’s ${machine.name}` : machine.name;
}

export function copyTeammateOriginal(original: TeammateOriginal): TeammateOriginal {
  return { ...original, owner: original.owner ? { ...original.owner } : null };
}

export function copyUnreachedTeammate(machine: UnreachedTeammate): UnreachedTeammate {
  return { ...machine, owner: machine.owner ? { ...machine.owner } : null };
}
