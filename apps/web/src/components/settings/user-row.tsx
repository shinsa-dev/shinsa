import type { RemoteUser } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { UserIdentity } from '@/components/people/user-tag.tsx';
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
  return (
    <div className={cn(SETTING_ROW, 'gap-2.5')}>
      <UserIdentity
        user={user}
        title={self ? 'You' : undefined}
        handle={self ? null : undefined}
        detail={detail}
        className='flex-1'
      />
      {children}
    </div>
  );
}
