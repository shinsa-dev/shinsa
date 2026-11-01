export { resolveFirstName } from '@shinsa/core';

import type { RemoteAccess, RemoteDevice, RemoteUser, SharedPerson } from '@shinsa/core';

export type UserProfile = Pick<RemoteUser, 'login' | 'name' | 'avatarUrl'>;

export function describeUserName(user: Pick<RemoteUser, 'login' | 'name'>) {
  return user.name ?? user.login;
}

export function describeUserHandle(user: Pick<RemoteUser, 'login' | 'name'>) {
  return user.name ? user.login : null;
}

export function resolveSharedProfile(login: string, profile: SharedPerson | null = null): UserProfile {
  return { login, name: profile?.name ?? null, avatarUrl: profile?.avatarUrl ?? null };
}

export function resolveGitHubProfileUrl(user: Pick<RemoteUser, 'login'>) {
  return `https://github.com/${encodeURIComponent(user.login)}`;
}

export function resolveUserInitial(user: Pick<RemoteUser, 'login' | 'name'>) {
  return describeUserName(user).slice(0, 1).toUpperCase();
}

export function selectDeviceMember(access: RemoteAccess | null, device: RemoteDevice) {
  return access?.members.find((member) => member.user.id === device.userId)?.user ?? null;
}
