import type { RemoteAccess, RemoteDevice, RemoteUser } from '@shinsa/core';

export function describeUserName(user: RemoteUser) {
  return user.name ?? `@${user.login}`;
}

export function describeUserHandle(user: RemoteUser) {
  return user.name ? `@${user.login}` : null;
}

export function resolveUserInitial(user: RemoteUser) {
  return describeUserName(user).replace(/^@/, '').slice(0, 1).toUpperCase();
}

export function selectDeviceMember(access: RemoteAccess | null, device: RemoteDevice) {
  return access?.members.find((member) => member.user.id === device.userId)?.user ?? null;
}
