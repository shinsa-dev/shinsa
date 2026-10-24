import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type { AccountProvider } from '@/lib/accounts/account.ts';

export function AccountName({ name, className }: { name: AccountProvider; className?: string }) {
  return (
    <span className='flex min-w-0 items-center gap-1.5'>
      <Icon size='sm' name={name.icon} />
      <Truncate className={cn('min-w-0', className)}>{name.label}</Truncate>
    </span>
  );
}
