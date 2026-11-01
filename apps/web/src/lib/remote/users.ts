import {
  type RemoteAccess,
  type RemoteDevice,
  type RemoteUser,
  resolveFirstName,
  type SharedPerson,
  selectTaskPerson,
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
  return (task ? selectTaskPerson(task, login) : null) ?? resolveSharedProfile(login);
}

function matchNameAsWord(text: string, name: string) {
  const word = `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`;
  const patterns = [`^${word}`, `${word}$`, word];
  for (const pattern of patterns) {
    const match = new RegExp(pattern, 'u').exec(text);
    if (match) return match.index;
  }
  return null;
}

export function resolvePersonMention(text: string, user: UserProfile): Mention | null {
  const name = resolveFirstName(user);
  const at = matchNameAsWord(text, name);
  if (at === null) return null;
  const before = text.slice(0, at);
  const after = text.slice(at + name.length);
  return [...(before ? [before] : []), { user }, ...(after ? [after] : [])];
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
