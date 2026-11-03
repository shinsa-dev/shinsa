import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { GlyphLabel } from '@/components/links/link.tsx';
import { InfoPopover } from '@/components/overlays/info-popover.tsx';
import {
  describeUserHandle,
  describeUserName,
  type Mention,
  resolveFirstName,
  resolveGitHubProfileUrl,
  resolveUserInitial,
  type UserProfile,
} from '@/lib/remote/users.ts';

const USER_TAG =
  'group/link cursor-pointer text-inherit no-underline outline-none hover:text-fg-4 active:text-fg-4';

const USER_AVATAR = {
  row: 'size-6.5',
  cell: 'size-4.5',
  menu: 'size-4',
  inline: 'relative -top-px ms-0.5 me-1 inline-grid size-3.5 align-middle',
} as const;

const USER_INITIAL = { row: undefined, cell: 'scale-90', menu: 'scale-90', inline: 'scale-75' } as const;

export function UserAvatar({ user, size }: { user: UserProfile; size: keyof typeof USER_AVATAR }) {
  const className = cn('shrink-0 rounded-full bg-bg-a2', USER_AVATAR[size]);
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

export function UserIdentity({
  user,
  title = describeUserName(user),
  handle = describeUserHandle(user),
  detail,
  className,
}: {
  user: UserProfile;
  title?: string;
  handle?: string | null;
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <UserAvatar user={user} size='row' />
      <div className='flex min-w-0 flex-col gap-px'>
        <Truncate className='text-xs'>
          <span className='font-medium text-fg-4'>{title}</span>
          {handle && <span className='ms-1 text-fg-2'>{handle}</span>}
        </Truncate>
        {detail && <Truncate className='text-2xs text-fg-2'>{detail}</Truncate>}
      </div>
    </div>
  );
}

function UserCard({ user, note }: { user: UserProfile; note?: string }) {
  return (
    <div className='flex flex-col gap-1.5 px-3 py-2.5'>
      <UserIdentity
        user={user}
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
      {note && <span className='ps-8.5 text-2xs text-fg-2'>{note}</span>}
    </div>
  );
}

export function UserTag({
  user,
  label = resolveFirstName(user),
  note,
  className,
}: {
  user: UserProfile;
  label?: string;
  note?: string;
  className?: string;
}) {
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
      trigger={<GlyphLabel glyph={<UserAvatar user={user} size='inline' />} text={label} />}
    >
      <UserCard user={user} note={note} />
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
