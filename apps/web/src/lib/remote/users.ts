import type { RemoteAccess, RemoteDevice, RemoteUser, SharedPerson } from '@shinsa/core';

export type UserProfile = Pick<RemoteUser, 'login' | 'name' | 'avatarUrl'>;

export function describeUserName(user: RemoteUser) {
  return user.name ?? `@${user.login}`;
}

export function describeUserHandle(user: RemoteUser) {
  return user.name ? `@${user.login}` : null;
}

export function resolveFirstName(user: Pick<RemoteUser, 'login' | 'name'>) {
  return user.name?.trim().split(/\s+/)[0] || user.login;
}

export function resolveSharedProfile(login: string, profile: SharedPerson | null = null): UserProfile {
  return { login, name: profile?.name ?? null, avatarUrl: profile?.avatarUrl ?? null };
}

export function resolveUserInitial(user: RemoteUser) {
  return describeUserName(user).replace(/^@/, '').slice(0, 1).toUpperCase();
}

export function selectDeviceMember(access: RemoteAccess | null, device: RemoteDevice) {
  return access?.members.find((member) => member.user.id === device.userId)?.user ?? null;
}
