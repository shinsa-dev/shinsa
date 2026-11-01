import type { Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { useCopyText } from '@/components/controls/copy-button.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useEngineCommand } from '@/lib/connection/socket.ts';
import {
  describeShareEnd,
  openShareDialog,
  openUnshareConfirm,
  SHARE_MANAGE_TITLE,
  SHARING_NOTE,
  selectLiveShare,
  UNSHARE_TITLE,
} from '@/lib/share/dialog.ts';
import {
  describeHandoffBanner,
  HANDOFF_COPY,
  HANDOFF_ICON,
  HANDOFF_REMOVE,
  HANDOFF_TURN_OFF,
  openHandoffRemoveConfirm,
  removeHandoff,
  resolveHandoffView,
} from '@/lib/share/handoff.ts';

const BANNER = cn(CARD, 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 ps-3 pe-1.5 text-xs');

function CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const { copied, copy } = useCopyText(url);
  return (
    <Button variant='secondary' size='sm' onClick={copy}>
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function SharingBanner({ task }: { task: Task }) {
  const share = selectLiveShare(task, useNow());
  if (!share) return null;
  return (
    <div role='status' className={BANNER}>
      <Icon size='sm' name='IconLiveFull' className='text-primary-text' />
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
        <Button variant='bare' size='sm' onClick={() => openShareDialog(task.id, 'share')}>
          {SHARE_MANAGE_TITLE}
        </Button>
        {share.url && <CopyLinkButton url={share.url} />}
        <Button variant='secondary' size='sm' onClick={() => openUnshareConfirm(task.id)}>
          {UNSHARE_TITLE}
        </Button>
      </div>
    </div>
  );
}

export function HandoffBanner({ task }: { task: Task }) {
  const owner = useEngineCommand('handoff.remove', task.id);
  const view = resolveHandoffView(task);
  const note = describeHandoffBanner(view);
  if (!(owner && note)) return null;
  return (
    <div role='status' className={BANNER}>
      <Icon size='sm' name={HANDOFF_ICON} className='text-primary-text' />
      <span className='min-w-48 flex-1 text-fg-4'>{note}</span>
      <div className='ms-auto flex shrink-0 items-center gap-2'>
        {view.kind === 'ready' && <CopyLinkButton url={view.url} label={HANDOFF_COPY} />}
        {view.kind === 'claimed' ? (
          <Button variant='secondary' size='sm' onClick={() => openHandoffRemoveConfirm(task.id)}>
            {HANDOFF_REMOVE}
          </Button>
        ) : (
          <Button variant='secondary' size='sm' onClick={() => void removeHandoff(task)}>
            {HANDOFF_TURN_OFF}
          </Button>
        )}
      </div>
    </div>
  );
}
