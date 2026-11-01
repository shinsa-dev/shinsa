import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { InfoAction, InfoPopover } from '@/components/overlays/info-popover.tsx';
import {
  describeUserHandle,
  describeUserName,
  resolveFirstName,
  resolveGitHubProfileUrl,
  resolveUserInitial,
  type UserProfile,
} from '@/lib/remote/users.ts';

const USER_TAG = 'cursor-pointer text-inherit no-underline outline-none hover:text-fg-4 active:text-fg-4';

export function UserAvatar({ user, className }: { user: UserProfile; className?: string }) {
  if (user.avatarUrl)
    return (
      <img
        src={user.avatarUrl}
        alt=''
        referrerPolicy='no-referrer'
        className={cn('size-6.5 shrink-0 rounded-full bg-bg-a2', className)}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6.5 shrink-0 place-items-center rounded-full bg-bg-a2 text-2xs text-fg-2',
        className
      )}
    >
      {resolveUserInitial(user)}
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
  detail?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <UserAvatar user={user} />
      <div className='flex min-w-0 flex-col gap-px'>
        <Truncate className='font-medium text-fg-4 text-xs'>{title}</Truncate>
        {(handle || detail) && (
          <Truncate className='text-2xs text-fg-2'>
            {handle && <span>{handle}</span>}
            {handle && detail && ' · '}
            {detail && <span>{detail}</span>}
          </Truncate>
        )}
      </div>
    </div>
  );
}

export function UserCard({ user, detail }: { user: UserProfile; detail?: string }) {
  return (
    <>
      <UserIdentity user={user} detail={detail} className='px-3 py-2.5' />
      <InfoAction label='View on GitHub' href={resolveGitHubProfileUrl(user)} />
    </>
  );
}

export function UserTag({
  user,
  label = resolveFirstName(user),
  detail,
  className,
}: {
  user: UserProfile;
  label?: string;
  detail?: string;
  className?: string;
}) {
  return (
    <InfoPopover
      className='w-60'
      render={
        <a
          href={resolveGitHubProfileUrl(user)}
          target='_blank'
          rel='noreferrer'
          onClick={(event) => event.stopPropagation()}
          className={cn(USER_TAG, className)}
        />
      }
      trigger={label}
    >
      <UserCard user={user} detail={detail} />
    </InfoPopover>
  );
}
