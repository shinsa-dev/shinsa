import type { TeamFeedTask } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { TEAM_ICON } from '@/components/focus/menu.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { UserAvatar } from '@/components/people/user-tag.tsx';
import { useRemoteSnapshot } from '@/lib/connection/socket.ts';
import { describeUserName, resolveSharedProfile, type UserProfile } from '@/lib/remote/users.ts';
import { describeTeamTaskOwner, describeTeamTaskPlace } from '@/lib/teams/feeds.ts';

export const YOU_OWNER = 'You';

function OwnerAvatar({ user, label, detail }: { user: UserProfile; label: string; detail?: string }) {
  return (
    <Hint label={label} detail={detail}>
      <span role='img' aria-label={label} className='inline-flex shrink-0'>
        <UserAvatar user={user} size='cell' />
      </span>
    </Hint>
  );
}

function MachineOwner({ label, detail }: { label: string; detail: string }) {
  return (
    <Hint label={label} detail={detail}>
      <span role='img' aria-label={label} className='grid size-4.5 shrink-0 place-items-center text-fg-2'>
        <Icon size='sm' name={TEAM_ICON} />
      </span>
    </Hint>
  );
}

export function YourOwnerMark() {
  const user = useRemoteSnapshot()?.access?.owner;
  if (!user) {
    return (
      <span role='img' aria-label={YOU_OWNER} className='grid size-4.5 shrink-0 place-items-center text-fg-2'>
        <Icon size='sm' name='IconUser' />
      </span>
    );
  }
  return <OwnerAvatar user={user} label={YOU_OWNER} detail={describeUserName(user)} />;
}

export function TeammateOwnerMark({ entry }: { entry: TeamFeedTask }) {
  const detail = describeTeamTaskPlace(entry);
  if (!entry.owner) return <MachineOwner label={describeTeamTaskOwner(entry)} detail={detail} />;
  const user = resolveSharedProfile(entry.owner, entry.ownerProfile);
  return <OwnerAvatar user={user} label={describeUserName(user)} detail={detail} />;
}
