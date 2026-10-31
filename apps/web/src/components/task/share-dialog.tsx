import type { ShareLimit, Task } from '@shinsa/core';
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
import { SelectField } from '@/components/controls/select-field.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { useShinsaSelector, useTask } from '@/lib/connection/selectors.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import {
  closeShareDialog,
  closeUnshareConfirm,
  listShareLimitItems,
  openUnshareConfirm,
  resolveShareLimitChoice,
  resolveShareView,
  SHARE_DESCRIPTION,
  SHARE_LIMIT_TITLE,
  SHARE_NEEDS_REMOTE,
  SHARE_TITLE,
  type ShareView,
  shareTask,
  UNSHARE_DESCRIPTION,
  UNSHARE_TITLE,
  unshareTask,
  useShareDialog,
  useUnshareConfirm,
} from '@/lib/share/dialog.ts';
import { navigate } from '@/router.ts';

function ShareLink({ url }: { url: string }) {
  return (
    <div className='relative w-full'>
      <Input readOnly value={url} aria-label='Share link' className='selectable pr-8' />
      <CopyButton text={url} className='absolute top-1/2 right-0.5 -translate-y-1/2' />
    </div>
  );
}

function ShareBody({ view }: { view: ShareView }) {
  switch (view.kind) {
    case 'unpaired':
      return <p className='text-fg-3 text-xs'>{SHARE_NEEDS_REMOTE}</p>;
    case 'off':
    case 'linking':
      return null;
    case 'failed':
      return (
        <p role='alert' className='selectable text-destructive text-xs'>
          {view.message}
        </p>
      );
    case 'shared':
      return <ShareLink url={view.url} />;
  }
}

function ShareLimitRow({
  task,
  limit,
  onChange,
}: {
  task: Task;
  limit: ShareLimit;
  onChange: (limit: ShareLimit) => void;
}) {
  return (
    <div className='flex w-full items-center justify-between gap-3 self-stretch'>
      <span className='text-fg-3 text-xs'>{SHARE_LIMIT_TITLE}</span>
      <SelectField
        label={SHARE_LIMIT_TITLE}
        items={listShareLimitItems(task)}
        value={limit}
        onValueChange={onChange}
      />
    </div>
  );
}

function ShareActions({ task, view, limit }: { task: Task; view: ShareView; limit: ShareLimit }) {
  const [busy, setBusy] = React.useState(false);
  const share = async () => {
    setBusy(true);
    await shareTask(task, limit);
    setBusy(false);
  };
  if (view.kind === 'unpaired') {
    return (
      <Button
        onClick={() => {
          closeShareDialog();
          navigate(resolveSettingsPath('general', 'Remote access'));
        }}
      >
        Open Settings
      </Button>
    );
  }
  if (view.kind === 'off' || view.kind === 'linking') {
    return (
      <Button loading={busy || view.kind === 'linking'} onClick={() => void share()}>
        Share
      </Button>
    );
  }
  return (
    <>
      <Button variant='secondary' onClick={() => openUnshareConfirm(task.id)}>
        {UNSHARE_TITLE}
      </Button>
      {view.kind === 'failed' ? (
        <Button loading={busy} onClick={() => void share()}>
          Try again
        </Button>
      ) : (
        <DialogClose render={<Button />}>Done</DialogClose>
      )}
    </>
  );
}

function ShareContent({ task }: { task: Task }) {
  const { snapshot } = useRemoteAccess();
  const settings = useShinsaSelector((state) => state.settings);
  const view = resolveShareView(task, snapshot);
  const [picked, setPicked] = React.useState<ShareLimit | null>(null);
  const limit =
    task.share?.limit ?? picked ?? (settings ? resolveShareLimitChoice(task, settings) : 'until_done');
  const changeLimit = (next: ShareLimit) => {
    setPicked(next);
    if (task.share) void shareTask(task, next);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{SHARE_TITLE}</DialogTitle>
        <DialogDescription>{SHARE_DESCRIPTION}</DialogDescription>
      </DialogHeader>
      <ShareBody view={view} />
      {view.kind !== 'unpaired' && <ShareLimitRow task={task} limit={limit} onChange={changeLimit} />}
      <DialogFooter>
        <ShareActions task={task} view={view} limit={limit} />
      </DialogFooter>
    </>
  );
}

export function ShareDialog() {
  const task = useTask(useShareDialog());
  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(next) => {
        if (!next) closeShareDialog();
      }}
    >
      <DialogContent>{task && <ShareContent task={task} />}</DialogContent>
    </Dialog>
  );
}

export function UnshareConfirm() {
  const taskId = useUnshareConfirm();
  const task = useTask(taskId);
  const confirming = React.useRef<Task | null>(null);
  if (task) confirming.current = task;
  return (
    <ConfirmDialog
      control={{
        open: Boolean(task),
        onOpenChange: (open) => {
          if (!open) closeUnshareConfirm();
        },
        onOpenChangeComplete: () => undefined,
      }}
      title={`${UNSHARE_TITLE}?`}
      body={UNSHARE_DESCRIPTION}
      action={UNSHARE_TITLE}
      onConfirm={() => {
        if (confirming.current) void unshareTask(confirming.current);
      }}
    />
  );
}
