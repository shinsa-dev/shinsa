import {
  type RemoteAccess,
  type RemoteDevice,
  type RemoteUser,
  resolveFirstName,
  type SharedPerson,
  type Task,
} from '@shinsa/core';

export { resolveFirstName };

export type UserProfile = Pick<RemoteUser, 'login' | 'name' | 'avatarUrl'>;

export type MentionPart = string | { user: UserProfile; label?: string };

export type Mention = readonly MentionPart[];

export function describeUserName(user: Pick<RemoteUser, 'login' | 'name'>) {
  return user.name ?? user.login;
}

export function describeUserHandle(user: Pick<RemoteUser, 'login' | 'name'>) {
  return user.name ? user.login : null;
}

export function resolveSharedProfile(login: string, profile: SharedPerson | null = null): UserProfile {
  return { login, name: profile?.name ?? null, avatarUrl: profile?.avatarUrl ?? null };
}

export function resolveGuestProfile(task: Task | null, login: string): UserProfile {
  const same = (person: UserProfile) => person.login.toLowerCase() === login.toLowerCase();
  const guest = task?.handoff?.guest;
  if (guest && same(guest)) return guest;
  const named = task?.activity.find((entry) => entry.person && same(entry.person))?.person;
  return named ?? resolveSharedProfile(login);
}

export function resolveGitHubProfileUrl(user: Pick<RemoteUser, 'login'>) {
  return `https://github.com/${encodeURIComponent(user.login)}`;
}

export function resolveUserInitial(user: Pick<RemoteUser, 'login' | 'name'>) {
  return describeUserName(user).slice(0, 1).toUpperCase();
}

export function describeMentionText(mention: Mention) {
  return mention
    .map((part) => (typeof part === 'string' ? part : (part.label ?? resolveFirstName(part.user))))
    .join('');
}

export function selectDeviceMember(access: RemoteAccess | null, device: RemoteDevice) {
  return access?.members.find((member) => member.user.id === device.userId)?.user ?? null;
}
