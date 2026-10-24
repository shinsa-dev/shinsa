import { cn } from '@shinsa/ui/lib/utils';
import { resolveUsageText } from '@/lib/accounts/usage.ts';

export function UsagePercent({ percent, className }: { percent: number; className?: string }) {
  return (
    <span className={cn('shrink-0 text-xs tabular-nums', resolveUsageText(percent), className)}>
      {percent}%
    </span>
  );
}
