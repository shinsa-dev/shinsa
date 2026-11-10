import { Option } from 'effect';
import type { ActivityPerson, Task } from './types.ts';

export function resolveFirstName(person: Pick<ActivityPerson, 'login' | 'name'>) {
  return person.name?.trim().split(/\s+/)[0] || person.login;
}

export function selectTaskPerson(
  task: Pick<Task, 'handoff' | 'activity'>,
  login: string
): Option.Option<ActivityPerson> {
  const guest = task.handoff?.guest;
  if (guest?.login === login) return Option.some({ login, name: guest.name, avatarUrl: guest.avatarUrl });
  const named = task.activity.filter((entry) => entry.person?.login === login);
  return Option.fromNullishOr(named.at(-1)?.person);
}

export function resolveGuestFirstName(task: Pick<Task, 'handoff' | 'activity'> | undefined, login: string) {
  if (!task) return login;
  return Option.match(selectTaskPerson(task, login), { onNone: () => login, onSome: resolveFirstName });
}
