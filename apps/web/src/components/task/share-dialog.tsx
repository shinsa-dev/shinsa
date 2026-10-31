import type { Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Input } from '@shinsa/ui/components/input';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { useTask } from '@/lib/connection/selectors.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import {
  closeShareDialog,
  resolveShareView,
  SHARE_DESCRIPTION,
  SHARE_NEEDS_REMOTE,
  SHARE_TITLE,
  type ShareView,
  shareTask,
  unshareTask,
  useShareDialog,
} from '@/lib/share/dialog.ts';
import { navigate, resolveSharePreviewPath } from '@/router.ts';

function openPage(path: string) {
  closeShareDialog();
  navigate(path);
}

function ShareBody({ view }: { view: ShareView }) {
  switch (view.kind) {
    case 'unpaired':
      return <p className='text-fg-3 text-xs'>{SHARE_NEEDS_REMOTE}</p>;
    case 'off':
      return null;
    case 'publishing':
      return <LoadingLine label='Making the link' className='text-fg-2 text-xs' />;
    case 'failed':
      return (
        <p role='alert' className='selectable text-destructive text-xs'>
          {view.message}
        </p>
      );
    case 'shared':
      return (
        <div className='flex w-full items-center gap-2'>
          <Input readOnly value={view.url} aria-label='Share link' className='selectable flex-1' />
          <CopyButton text={view.url} />
        </div>
      );
  }
}

function ShareActions({ task, view }: { task: Task; view: ShareView }) {
  const [busy, setBusy] = React.useState(false);
  const act = async (send: (task: Task) => Promise<unknown>) => {
    setBusy(true);
    await send(task);
    setBusy(false);
  };
  const preview = (
    <Button variant='secondary' onClick={() => openPage(resolveSharePreviewPath(task))}>
      Preview
    </Button>
  );
  if (view.kind === 'unpaired') {
    return (
      <>
        {preview}
        <Button onClick={() => openPage(resolveSettingsPath('general', 'Remote access'))}>
          Open Settings
        </Button>
      </>
    );
  }
  if (view.kind === 'off') {
    return (
      <>
        {preview}
        <Button loading={busy} onClick={() => void act(shareTask)}>
          Share
        </Button>
      </>
    );
  }
  return (
    <>
      <Button variant='secondary' loading={busy} onClick={() => void act(unshareTask)}>
        Stop sharing
      </Button>
      {view.kind === 'failed' && (
        <Button loading={busy} onClick={() => void act(shareTask)}>
          Try again
        </Button>
      )}
      {view.kind !== 'failed' && preview}
      {view.kind === 'shared' && <DialogClose render={<Button />}>Done</DialogClose>}
    </>
  );
}

export function ShareDialog() {
  const taskId = useShareDialog();
  const task = useTask(taskId);
  const { snapshot } = useRemoteAccess();
  const view = task ? resolveShareView(task, snapshot) : null;
  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(next) => {
        if (!next) closeShareDialog();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{SHARE_TITLE}</DialogTitle>
          <DialogDescription>{SHARE_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        {view && <ShareBody view={view} />}
        <DialogFooter>{task && view && <ShareActions task={task} view={view} />}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
