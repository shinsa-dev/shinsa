import type { Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { useCopyText } from '@/components/controls/copy-button.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useNow } from '@/hooks/use-now.ts';
import {
  describeShareEnd,
  openUnshareConfirm,
  SHARING_NOTE,
  selectLiveShare,
  UNSHARE_TITLE,
} from '@/lib/share/dialog.ts';

function CopyLinkButton({ url }: { url: string }) {
  const { copied, copy } = useCopyText(url);
  return (
    <Button variant='secondary' size='sm' onClick={copy}>
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

export function SharingBanner({ task }: { task: Task }) {
  const share = selectLiveShare(task, useNow());
  if (!share) return null;
  return (
    <div
      role='status'
      className={cn(CARD, 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 ps-3 pe-1.5 text-xs')}
    >
      <Icon size='sm' name='IconShareOs' className='text-primary-text' />
      <span className='min-w-48 flex-1 text-fg-3'>
        <span className='text-fg-4'>{SHARING_NOTE}</span>{' '}
        {share.endsAt === null ? (
          describeShareEnd(share)
        ) : (
          <TimeAgo at={share.endsAt} text={(now) => describeShareEnd(share, now)} />
        )}
        .
      </span>
      <div className='ms-auto flex shrink-0 items-center gap-2'>
        {share.url && <CopyLinkButton url={share.url} />}
        <Button variant='secondary' size='sm' onClick={() => openUnshareConfirm(task.id)}>
          {UNSHARE_TITLE}
        </Button>
      </div>
    </div>
  );
}
