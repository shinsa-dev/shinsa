import { cn } from '@shinsa/ui/lib/utils';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { type AccountStatus, describeAccountStatus } from '@/lib/accounts/usage.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';

export function AccountStatusText({ status, className }: { status: AccountStatus; className?: string }) {
  const { until } = status;
  return (
    <span className={cn('shrink-0', TONE_TEXT[status.tone], className)}>
      {until === null ? (
        status.label
      ) : (
        <TimeAgo at={until} text={(now) => describeAccountStatus(status, now)} />
      )}
    </span>
  );
}
