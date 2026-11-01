import type { ShareLimit, SharePreset, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Field, FieldLabel } from '@shinsa/ui/components/field';
import * as React from 'react';
import { useCopyText } from '@/components/controls/copy-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { useShinsaSelector, useTask } from '@/lib/connection/selectors.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import {
  changeShareLimit,
  changeSharePreset,
  closeShareDialog,
  closeUnshareConfirm,
  listShareLimitItems,
  openUnshareConfirm,
  resolveShareLimitChoice,
  resolveSharePresetChoice,
  resolveShareView,
  SHARE_DESCRIPTION,
  SHARE_LIMIT_TITLE,
  SHARE_NEEDS_REMOTE,
  SHARE_PRESET_ITEMS,
  SHARE_PRESET_TITLE,
  SHARE_TITLE,
  type ShareView,
  selectLiveShare,
  shareTask,
  UNSHARE_DESCRIPTION,
  UNSHARE_TITLE,
  unshareTask,
  useShareDialog,
  useUnshareConfirm,
} from '@/lib/share/dialog.ts';
import { navigate } from '@/router.ts';

function ShareBody({ view }: { view: ShareView }) {
  switch (view.kind) {
    case 'unpaired':
      return <p className='text-fg-3 text-xs'>{SHARE_NEEDS_REMOTE}</p>;
    case 'off':
    case 'linking':
    case 'shared':
      return null;
    case 'failed':
      return (
        <p role='alert' className='selectable text-destructive text-xs'>
          {view.message}
        </p>
      );
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
    <Field className='w-full'>
      <FieldLabel>{SHARE_LIMIT_TITLE}</FieldLabel>
      <SelectField
        label={SHARE_LIMIT_TITLE}
        align='start'
        className='w-full'
        items={listShareLimitItems(task)}
        value={limit}
        onValueChange={onChange}
      />
    </Field>
  );
}

function SharePresetRow({
  preset,
  onChange,
}: {
  preset: SharePreset;
  onChange: (preset: SharePreset) => void;
}) {
  return (
    <Field className='w-full'>
      <FieldLabel>{SHARE_PRESET_TITLE}</FieldLabel>
      <SelectField
        label={SHARE_PRESET_TITLE}
        align='start'
        className='w-full'
        items={SHARE_PRESET_ITEMS}
        value={preset}
        onValueChange={onChange}
      />
    </Field>
  );
}

function ShareActions({
  task,
  view,
  limit,
  preset,
}: {
  task: Task;
  view: ShareView;
  limit: ShareLimit;
  preset: SharePreset;
}) {
  const [busy, setBusy] = React.useState(false);
  const share = async () => {
    setBusy(true);
    await shareTask(task, limit, preset);
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
  if (view.kind === 'shared') {
    return (
      <>
        <Button variant='secondary' onClick={() => openUnshareConfirm(task.id)}>
          {UNSHARE_TITLE}
        </Button>
        <CopyLinkButton url={view.url} />
        <Button onClick={closeShareDialog}>Done</Button>
      </>
    );
  }
  if (view.kind === 'failed') {
    return (
      <>
        <Button variant='secondary' onClick={() => openUnshareConfirm(task.id)}>
          {UNSHARE_TITLE}
        </Button>
        <Button loading={busy} onClick={() => void share()}>
          Try again
        </Button>
      </>
    );
  }
  return (
    <Button loading={busy || view.kind !== 'off'} onClick={() => void share()}>
      Share
    </Button>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const { copied, copy } = useCopyText(url);
  return (
    <Button variant='secondary' onClick={copy}>
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

function ShareContent({ task }: { task: Task }) {
  const { snapshot } = useRemoteAccess();
  const settings = useShinsaSelector((state) => state.settings);
  const now = useNow();
  const live = selectLiveShare(task, now);
  const view = resolveShareView(task, snapshot, now);
  const shared = view.kind === 'shared';
  const openedShared = React.useRef(shared);
  React.useEffect(() => {
    if (shared && !openedShared.current) closeShareDialog();
  }, [shared]);
  const [picked, setPicked] = React.useState<ShareLimit | null>(null);
  const limit = picked ?? live?.limit ?? (settings ? resolveShareLimitChoice(task, settings) : 'until_done');
  const [pickedPreset, setPickedPreset] = React.useState<SharePreset | null>(null);
  const preset = pickedPreset ?? resolveSharePresetChoice(task, settings);
  const pickLimit = (next: ShareLimit) => {
    if (shared) void changeShareLimit(task, next);
    else setPicked(next);
  };
  const pickPreset = (next: SharePreset) => {
    if (shared) void changeSharePreset(task, next);
    else setPickedPreset(next);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{SHARE_TITLE}</DialogTitle>
        <DialogDescription>{SHARE_DESCRIPTION}</DialogDescription>
      </DialogHeader>
      <ShareBody view={view} />
      {view.kind !== 'unpaired' && (
        <>
          <SharePresetRow preset={shared && live ? live.preset : preset} onChange={pickPreset} />
          <ShareLimitRow task={task} limit={shared && live ? live.limit : limit} onChange={pickLimit} />
        </>
      )}
      <DialogFooter>
        <ShareActions task={task} view={view} limit={limit} preset={preset} />
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
