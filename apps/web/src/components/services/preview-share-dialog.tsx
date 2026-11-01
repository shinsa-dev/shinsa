import { type PreviewShare, resolveShareLimit, type ShareLimit, type Task } from '@shinsa/core';
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
import { Field, FieldLabel } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { useShinsaSelector, useTask } from '@/lib/connection/selectors.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import { listShareLimitItems, SHARE_LIMIT_TITLE, type ShareView } from '@/lib/share/dialog.ts';
import {
  closePreviewShareDialog,
  describePreviewEnd,
  PREVIEW_LINK_TITLE,
  PREVIEW_NEEDS_REMOTE,
  PREVIEW_SHARE_DESCRIPTION,
  PREVIEW_SHARE_TITLE,
  type PreviewTarget,
  resolvePreviewShareView,
  selectLivePreview,
  sharePreview,
  UNSHARE_TITLE,
  unsharePreview,
  usePreviewShareDialog,
} from '@/lib/share/previews.ts';
import { navigate } from '@/router.ts';

function PreviewLink({ url }: { url: string }) {
  return (
    <div className='relative w-full'>
      <Input
        readOnly
        value={url}
        aria-label={PREVIEW_LINK_TITLE}
        className='selectable pr-8 read-only:border-0'
      />
      <CopyButton text={url} className='absolute top-1/2 right-0.5 -translate-y-1/2' />
    </div>
  );
}

function PreviewDescription({ preview, shared }: { preview: PreviewShare | null; shared: boolean }) {
  if (!preview || !shared) return <DialogDescription>{PREVIEW_SHARE_DESCRIPTION}</DialogDescription>;
  return (
    <DialogDescription>
      {PREVIEW_SHARE_DESCRIPTION}{' '}
      {preview.endsAt === null ? (
        describePreviewEnd(preview)
      ) : (
        <TimeAgo at={preview.endsAt} text={(now) => describePreviewEnd(preview, now)} />
      )}
      .
    </DialogDescription>
  );
}

function PreviewBody({ view }: { view: ShareView }) {
  switch (view.kind) {
    case 'unpaired':
      return <p className='text-fg-3 text-xs'>{PREVIEW_NEEDS_REMOTE}</p>;
    case 'shared':
      return <PreviewLink url={view.url} />;
    case 'failed':
      return (
        <p role='alert' className='selectable text-destructive text-xs'>
          {view.message}
        </p>
      );
    case 'off':
    case 'linking':
      return null;
  }
}

export interface PreviewShareActions {
  share: (limit: ShareLimit) => Promise<unknown>;
  stop: () => void;
  close: () => void;
  openSettings: () => void;
}

function PreviewActions({
  view,
  limit,
  actions,
}: {
  view: ShareView;
  limit: ShareLimit;
  actions: PreviewShareActions;
}) {
  const [busy, setBusy] = React.useState(false);
  const share = async () => {
    setBusy(true);
    await actions.share(limit);
    setBusy(false);
  };
  const stop = (
    <Button
      variant='secondary'
      onClick={() => {
        actions.stop();
        actions.close();
      }}
    >
      {UNSHARE_TITLE}
    </Button>
  );
  switch (view.kind) {
    case 'unpaired':
      return <Button onClick={actions.openSettings}>Open Settings</Button>;
    case 'shared':
      return (
        <>
          {stop}
          <DialogClose render={<Button />}>Done</DialogClose>
        </>
      );
    case 'failed':
      return (
        <>
          {stop}
          <Button loading={busy} onClick={() => void share()}>
            Try again
          </Button>
        </>
      );
    case 'off':
    case 'linking':
      return (
        <Button loading={busy || view.kind === 'linking'} onClick={() => void share()}>
          Share
        </Button>
      );
  }
}

export function PreviewShareView({
  task,
  view,
  preview,
  defaultLimit,
  actions,
}: {
  task: Task;
  view: ShareView;
  preview: PreviewShare | null;
  defaultLimit: ShareLimit;
  actions: PreviewShareActions;
}) {
  const [picked, setPicked] = React.useState<ShareLimit | null>(null);
  const limit = preview?.limit ?? picked ?? defaultLimit;
  const changeLimit = (next: ShareLimit) => {
    setPicked(next);
    if (preview) void actions.share(next);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{PREVIEW_SHARE_TITLE}</DialogTitle>
        <PreviewDescription preview={preview} shared={view.kind === 'shared'} />
      </DialogHeader>
      <PreviewBody view={view} />
      {view.kind !== 'unpaired' && (
        <Field className='w-full'>
          <FieldLabel>{SHARE_LIMIT_TITLE}</FieldLabel>
          <SelectField
            label={SHARE_LIMIT_TITLE}
            align='start'
            className='w-full'
            items={listShareLimitItems(task)}
            value={limit}
            onValueChange={changeLimit}
          />
        </Field>
      )}
      <DialogFooter>
        <PreviewActions view={view} limit={limit} actions={actions} />
      </DialogFooter>
    </>
  );
}

function PreviewShareContent({ task, target }: { task: Task; target: PreviewTarget }) {
  const { snapshot } = useRemoteAccess();
  const settings = useShinsaSelector((state) => state.settings);
  const now = useNow();
  const actions: PreviewShareActions = {
    share: (limit) => sharePreview(target, limit),
    stop: () => void unsharePreview(target),
    close: closePreviewShareDialog,
    openSettings: () => {
      closePreviewShareDialog();
      navigate(resolveSettingsPath('general', 'Remote access'));
    },
  };
  return (
    <PreviewShareView
      task={task}
      view={resolvePreviewShareView(task, target.serviceId, snapshot, now)}
      preview={selectLivePreview(task, target.serviceId, now)}
      defaultLimit={settings ? resolveShareLimit(settings) : 'until_done'}
      actions={actions}
    />
  );
}

export function PreviewShareDialog() {
  const target = usePreviewShareDialog();
  const task = useTask(target?.taskId ?? null);
  return (
    <Dialog
      open={Boolean(target && task)}
      onOpenChange={(next) => {
        if (!next) closePreviewShareDialog();
      }}
    >
      <DialogContent>{target && task && <PreviewShareContent task={task} target={target} />}</DialogContent>
    </Dialog>
  );
}
