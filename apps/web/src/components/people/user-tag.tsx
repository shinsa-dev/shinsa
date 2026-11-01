import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { GlyphLabel } from '@/components/links/link.tsx';
import { InfoPopover } from '@/components/overlays/info-popover.tsx';
import {
  describeUserHandle,
  describeUserName,
  resolveFirstName,
  resolveGitHubProfileUrl,
  resolveUserInitial,
  type UserProfile,
} from '@/lib/remote/users.ts';

const USER_TAG =
  'group/link cursor-pointer text-inherit no-underline outline-none hover:text-fg-4 active:text-fg-4';

const USER_AVATAR = {
  row: 'size-6.5',
  inline: 'relative -top-px ms-0.5 me-1 inline-grid size-4 align-middle',
} as const;

const USER_INITIAL = { row: undefined, inline: 'scale-75' } as const;

function UserAvatar({ user, size }: { user: UserProfile; size: keyof typeof USER_AVATAR }) {
  const className = cn('shrink-0 rounded-full bg-bg-a2', USER_AVATAR[size]);
  if (user.avatarUrl)
    return <img src={user.avatarUrl} alt='' referrerPolicy='no-referrer' className={className} />;
  return (
    <span
      aria-hidden
      className={cn('grid place-items-center font-medium text-2xs text-fg-2 leading-none', className)}
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

function UserCard({ user }: { user: UserProfile }) {
  return (
    <UserIdentity
      user={user}
      className='px-3 py-2.5'
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
  );
}

export function UserTag({
  user,
  label = resolveFirstName(user),
  className,
}: {
  user: UserProfile;
  label?: string;
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
      <UserCard user={user} />
    </InfoPopover>
  );
}
