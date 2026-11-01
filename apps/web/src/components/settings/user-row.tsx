import type { RemoteUser } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { UserAvatar } from '@/components/people/user-tag.tsx';
import { describeUserHandle, describeUserName } from '@/lib/remote/users.ts';
import { SETTING_ROW } from './group.tsx';

export function UserRow({
  user,
  detail,
  self = false,
  children,
}: {
  user: RemoteUser;
  detail: string;
  self?: boolean;
  children?: React.ReactNode;
}) {
  const handle = self ? null : describeUserHandle(user);
  return (
    <div className={cn(SETTING_ROW, 'gap-2.5')}>
      <UserAvatar user={user} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex min-w-0 items-center gap-1.5 text-xs'>
          <Truncate className='text-fg-4'>{self ? 'You' : describeUserName(user)}</Truncate>
          {handle && <span className='shrink-0 text-fg-2'>{handle}</span>}
        </div>
        <Truncate className='text-2xs text-fg-2'>{detail}</Truncate>
      </div>
      {children}
    </div>
  );
}
