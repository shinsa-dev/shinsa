import type { ActivityPerson, Task } from './types.ts';

export function resolveFirstName(person: Pick<ActivityPerson, 'login' | 'name'>) {
  return person.name?.trim().split(/\s+/)[0] || person.login;
}

export function selectTaskPerson(
  task: Pick<Task, 'handoff' | 'activity'>,
  login: string
): ActivityPerson | null {
  const guest = task.handoff?.guest;
  if (guest?.login === login) return { login, name: guest.name, avatarUrl: guest.avatarUrl };
  const named = task.activity.filter((entry) => entry.person?.login === login);
  return named.at(-1)?.person ?? null;
}

export function resolveGuestFirstName(task: Pick<Task, 'handoff' | 'activity'> | undefined, login: string) {
  const person = task ? selectTaskPerson(task, login) : null;
  return person ? resolveFirstName(person) : login;
}
