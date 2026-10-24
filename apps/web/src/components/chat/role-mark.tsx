import type { Run } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { RUN_ROLE } from '@/lib/chat/run-role.ts';

export function RoleMark({ role, className }: { role: Run['role']; className?: string }) {
  const mark = RUN_ROLE[role];
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      <Icon size='sm' name={mark.icon} />
      {mark.name}
    </span>
  );
}
