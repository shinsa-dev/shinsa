import type { ServiceView, ShinsaState, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { ServiceActionButton } from '@/components/services/service-row.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useTask } from '@/lib/connection/selectors.ts';
import { useTerminals } from '@/lib/connection/terminals.ts';
import {
  isPreviewShared,
  openPreviewShareDialog,
  PREVIEW_SHARE_TITLE,
  PREVIEW_SHARED_TITLE,
  resolvePreviewTarget,
} from '@/lib/share/previews.ts';
import { listTaskPreviews, selectServicePreview } from '@/lib/terminal/services.ts';

export const PREVIEW_LINK =
  'corner-superellipse/1.125 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control bg-bg-2 px-2.5 text-xs hover:bg-bg-3 active:bg-bg-3';

export function useTaskPreviews(state: ShinsaState, task: Task) {
  const snapshot = useTerminals();
  const now = useNow();
  return listTaskPreviews(state, snapshot, task, now);
}

export interface PreviewSharing {
  isShared: (view: ServiceView) => boolean;
  open: (view: ServiceView) => void;
}

export const PreviewSharingSample = React.createContext<PreviewSharing | null>(null);

export function PreviewShareButton({ view }: { view: ServiceView }) {
  const sample = React.useContext(PreviewSharingSample);
  const task = useTask(view.taskId);
  const target = resolvePreviewTarget(view);
  const now = useNow();
  if (!(target && (sample || task))) return null;
  const shared = sample ? sample.isShared(view) : task ? isPreviewShared(task, target.serviceId, now) : false;
  return (
    <ServiceActionButton
      label={shared ? PREVIEW_SHARED_TITLE : PREVIEW_SHARE_TITLE}
      detail={view.service.name}
      icon={shared ? 'IconLiveFull' : 'IconShareOs'}
      onClick={() => (sample ? sample.open(view) : openPreviewShareDialog(target))}
    />
  );
}

export function PreviewLinkRow({
  share,
  children,
}: {
  share: ServiceView | null;
  children: React.ReactNode;
}) {
  return (
    <div className='flex min-w-0 items-center gap-1'>
      {children}
      {share && <PreviewShareButton view={share} />}
    </div>
  );
}

export function TaskPreviewLinks({ views }: { views: ServiceView[] }) {
  return (
    <div className='flex flex-col gap-1'>
      {views.map((view) => {
        const url = selectServicePreview(view);
        if (!url) return null;
        return (
          <PreviewLinkRow key={view.service.id} share={view}>
            <a href={url} target='_blank' rel='noreferrer' className={PREVIEW_LINK}>
              <Icon size='sm' name='IconArrowUpRight' className='shrink-0 text-fg-2' />
              <span className='shrink-0 font-medium text-fg-4'>{view.service.name}</span>
              <Truncate className='min-w-0 text-2xs text-fg-2'>{url}</Truncate>
            </a>
          </PreviewLinkRow>
        );
      })}
    </div>
  );
}
