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
        className={cn('size-6 shrink-0 rounded-full bg-bg-a2', className)}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full bg-bg-a2 text-2xs text-fg-2',
        className
      )}
    >
      {resolveUserInitial(user)}
    </span>
  );
}

export function UserCard({ user, detail }: { user: UserProfile; detail?: string }) {
  const handle = describeUserHandle(user);
  return (
    <>
      <div className='flex items-center gap-2.5 px-3 py-2.5'>
        <UserAvatar user={user} className='size-8' />
        <div className='flex min-w-0 flex-col gap-px'>
          <Truncate className='font-medium text-fg-4 text-xs'>{describeUserName(user)}</Truncate>
          {handle && <Truncate className='text-2xs text-fg-2'>{handle}</Truncate>}
          {detail && <Truncate className='text-2xs text-fg-2'>{detail}</Truncate>}
        </div>
      </div>
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
