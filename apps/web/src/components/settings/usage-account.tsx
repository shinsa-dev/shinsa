import { Badge } from '@shinsa/ui/components/badge';
import type * as React from 'react';
import { AccountName } from '@/components/accounts/account-name.tsx';
import { AccountStatusText } from '@/components/accounts/account-status.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import { describeUsageChecked, type UsageAccountHeader } from '@/lib/accounts/usage.ts';
import { SettingsBlock } from './group.tsx';

export function UsageAccountBlock({
  header,
  menu,
  children,
}: {
  header: UsageAccountHeader;
  menu: React.ReactNode;
  children: React.ReactNode;
}) {
  const { checkedAt, retryAt } = header;
  return (
    <SettingsBlock
      header={
        <>
          <div className='flex min-w-0 flex-1 items-center gap-1.5 text-xs'>
            <AccountName name={header.name} className='font-medium text-fg-4' />
            {header.detail && <span className='shrink-0 text-fg-2'>{header.detail}</span>}
            {header.isDefault && (
              <Badge size='sm' className='ms-0.5'>
                {ACCOUNT_LABEL.default}
              </Badge>
            )}
            {header.status && <AccountStatusText status={header.status} className='ms-0.5' />}
          </div>
          {checkedAt !== null && (
            <span className='hidden shrink-0 text-2xs text-fg-2 sm:inline'>
              <TimeAgo at={checkedAt} text={(now) => describeUsageChecked(checkedAt, retryAt, now)} />
            </span>
          )}
          {menu}
        </>
      }
    >
      {children}
    </SettingsBlock>
  );
}
