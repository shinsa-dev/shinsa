import type { TeamPresence } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { GlyphLabel } from '@/components/links/link.tsx';
import { InfoPopover } from '@/components/overlays/info-popover.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { usePersonPresence } from '@/hooks/use-team-presence.ts';
import {
  describeUserHandle,
  describeUserName,
  type Mention,
  resolveFirstName,
  resolveGitHubProfileUrl,
  resolveUserInitial,
  type UserProfile,
} from '@/lib/remote/users.ts';
import { describePresence, PRESENCE_DOT, PRESENCE_LABELS } from '@/lib/teams/presence.ts';

const USER_TAG =
  'group/link cursor-pointer text-inherit no-underline outline-none hover:text-fg-4 active:text-fg-4';

const USER_AVATAR = {
  row: 'size-6.5',
  cell: 'size-4.5',
  menu: 'size-4',
  inline: 'relative -top-px ms-0.5 me-1 inline-grid size-3.5 align-middle',
} as const;

const USER_INITIAL = { row: undefined, cell: 'scale-90', menu: 'scale-90', inline: 'scale-75' } as const;

const PRESENCE_DOT_SIZE = {
  row: 'size-1.5 ring-2',
  cell: 'size-1 ring-1',
  menu: 'size-1 ring-1',
  inline: 'size-1 ring-1',
} as const;

function AvatarFace({
  user,
  size,
  className,
}: {
  user: UserProfile;
  size: keyof typeof USER_AVATAR;
  className: string;
}) {
  if (user.avatarUrl)
    return <img src={user.avatarUrl} alt='' referrerPolicy='no-referrer' className={className} />;
  return (
    <span
      aria-hidden
      className={cn('grid place-items-center text-2xs leading-none font-medium text-fg-2', className)}
    >
      <span className={USER_INITIAL[size]}>{resolveUserInitial(user)}</span>
    </span>
  );
}

export function UserAvatar({
  user,
  size,
  presence = null,
}: {
  user: UserProfile;
  size: keyof typeof USER_AVATAR;
  presence?: TeamPresence | null;
}) {
  if (!presence)
    return (
      <AvatarFace
        user={user}
        size={size}
        className={cn('shrink-0 rounded-full bg-bg-a2', USER_AVATAR[size])}
      />
    );
  return (
    <span className={cn('relative shrink-0', USER_AVATAR[size])}>
      <AvatarFace user={user} size={size} className='size-full rounded-full bg-bg-a2' />
      <span
        role='img'
        aria-label={PRESENCE_LABELS[presence.status]}
        className={cn(
          'absolute right-[0.5px] bottom-[0.5px] rounded-full ring-card',
          PRESENCE_DOT[presence.status],
          PRESENCE_DOT_SIZE[size]
        )}
      />
    </span>
  );
}

export function UserIdentity({
  user,
  title = describeUserName(user),
  handle = describeUserHandle(user),
  detail,
  presence = null,
  className,
}: {
  user: UserProfile;
  title?: string;
  handle?: string | null;
  detail?: React.ReactNode;
  presence?: TeamPresence | null;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <UserAvatar user={user} size='row' presence={presence} />
      <div className='flex min-w-0 flex-col'>
        <Truncate className='text-xs'>
          <span className='font-medium text-fg-4'>{title}</span>
          {handle && <span className='ms-1 text-fg-2'>{handle}</span>}
        </Truncate>
        {detail && <Truncate className='text-2xs text-fg-2'>{detail}</Truncate>}
      </div>
    </div>
  );
}

function UserCard({
  user,
  note,
  presence,
}: {
  user: UserProfile;
  note?: string;
  presence: TeamPresence | null;
}) {
  const now = useNow();
  const seen = presence ? describePresence(presence, now) : null;
  return (
    <div className='flex flex-col gap-1.5 px-3 py-2.5'>
      <UserIdentity
        user={user}
        presence={presence}
        detail={
          <a
            href={resolveGitHubProfileUrl(user)}
            target='_blank'
            rel='noreferrer'
            onClick={(event) => event.stopPropagation()}
            className='inline-flex cursor-pointer items-center gap-1 text-primary-text no-underline outline-none hover:opacity-80 active:opacity-80'
          >
            View on GitHub
            <Icon size='sm' name='IconArrowUpRight' />
          </a>
        }
      />
      {seen && <span className='ps-8.5 text-2xs text-fg-2'>{seen}</span>}
      {note && <span className='ps-8.5 text-2xs text-fg-2'>{note}</span>}
    </div>
  );
}

function resolveUserId(user: UserProfile) {
  return 'id' in user && typeof user.id === 'string' ? user.id : null;
}

export function UserTag({
  user,
  userId = resolveUserId(user),
  label = resolveFirstName(user),
  note,
  className,
}: {
  user: UserProfile;
  userId?: string | null;
  label?: string;
  note?: string;
  className?: string;
}) {
  const presence = usePersonPresence(userId);
  return (
    <InfoPopover
      className='w-max max-w-64'
      render={
        <a
          href={resolveGitHubProfileUrl(user)}
          target='_blank'
          rel='noreferrer'
          onClick={(event) => event.stopPropagation()}
          className={cn(USER_TAG, className)}
        />
      }
      trigger={
        <GlyphLabel glyph={<UserAvatar user={user} size='inline' presence={presence} />} text={label} />
      }
    >
      <UserCard user={user} note={note} presence={presence} />
    </InfoPopover>
  );
}

export function MentionText({ mention }: { mention: Mention }) {
  return mention.map((part, index) =>
    typeof part === 'string' ? (
      part
    ) : (
      // oxlint-disable-next-line shinsa/no-array-index-key -- one sentence can name the same person twice
      <UserTag key={index} user={part.user} label={part.label} />
    )
  );
}
