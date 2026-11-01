import { DAY_MS, type PreviewShare, type Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Dialog, DialogContent } from '@shinsa/ui/components/dialog';
import * as React from 'react';
import { type PreviewShareActions, PreviewShareView } from '@/components/services/preview-share-dialog.tsx';
import type { ShareView } from '@/lib/share/dialog.ts';
import { acknowledgeSample, createSampleTask } from './samples.ts';

const URL = 'https://kbqwy3dpeb2gs5dfmvzgk43uojxw2mzrgq.shinsa.page/?key=Zk3vQ9pX2mR7tL1wN8yB4cH6jD0sF5gA';

interface PreviewState {
  label: string;
  view: ShareView;
  preview: PreviewShare | null;
}

function createPreviewScene(now: number) {
  const preview: PreviewShare = { serviceId: 'web', at: now, url: URL, limit: 'day', endsAt: now + DAY_MS };
  const task: Task = { ...createSampleTask(now, { id: 'sh-4', title: 'Fix the cart' }), previews: [preview] };
  const states: PreviewState[] = [
    { label: 'Share', view: { kind: 'off' }, preview: null },
    { label: 'Shared', view: { kind: 'shared', url: URL }, preview },
    {
      label: 'Failed',
      view: { kind: 'failed', message: 'This service has no preview URL, so there is nothing to share.' },
      preview: { ...preview, url: null },
    },
  ];
  return { task, states };
}

const ACTIONS: PreviewShareActions = {
  share: acknowledgeSample,
  stop: () => void acknowledgeSample(),
  close: () => void acknowledgeSample(),
  openSettings: () => void acknowledgeSample(),
};

export function PreviewShareSpecimen() {
  const [{ task, states }] = React.useState(() => createPreviewScene(Date.now()));
  const [open, setOpen] = React.useState<number | null>(null);
  const state = open === null ? null : states[open];
  return (
    <div className='flex flex-wrap gap-2'>
      {states.map((entry, index) => (
        <Button key={entry.label} variant='outline' size='sm' onClick={() => setOpen(index)}>
          {entry.label}
        </Button>
      ))}
      <Dialog open={state !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent>
          {state && (
            <PreviewShareView
              task={task}
              view={state.view}
              preview={state.preview}
              defaultLimit='until_done'
              actions={ACTIONS}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
