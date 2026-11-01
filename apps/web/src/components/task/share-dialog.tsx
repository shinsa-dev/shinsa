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
import { Separator } from '@shinsa/ui/components/separator';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { useCopyText } from '@/components/controls/copy-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { UserAvatar } from '@/components/settings/user-row.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { useShinsaSelector, useTask } from '@/lib/connection/selectors.ts';
import { useEngineCommand } from '@/lib/connection/socket.ts';
import { formatSince } from '@/lib/format/time.ts';
import { describeUserHandle, describeUserName } from '@/lib/remote/users.ts';
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
import {
  canHandOff,
  closeHandoffRemoveConfirm,
  describeHandoffClaim,
  HANDOFF_COPY,
  HANDOFF_DESCRIPTION,
  HANDOFF_REMOVE,
  HANDOFF_REMOVE_DESCRIPTION,
  HANDOFF_TITLE,
  type HandoffView,
  handOffTask,
  openHandoffRemoveConfirm,
  removeHandoff,
  resolveHandoffView,
  useHandoffRemoveConfirm,
} from '@/lib/share/handoff.ts';
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

function CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const { copied, copy } = useCopyText(url);
  return (
    <Button variant='secondary' onClick={copy}>
      {copied ? 'Copied' : label}
    </Button>
  );
}

function HandoffGuest({ view }: { view: Extract<HandoffView, { kind: 'claimed' }> }) {
  const handle = describeUserHandle(view.guest);
  return (
    <div className='flex min-w-0 flex-1 items-center gap-2.5'>
      <UserAvatar user={view.guest} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex min-w-0 items-center gap-1.5 text-xs'>
          <Truncate className='text-fg-4'>{describeUserName(view.guest)}</Truncate>
          {handle && <span className='shrink-0 text-fg-2'>{handle}</span>}
        </div>
        <span className='text-2xs text-fg-2'>
          <TimeAgo at={view.at} text={(now) => formatSince('Took it over', view.at, now)} />
        </span>
      </div>
    </div>
  );
}

function HandoffRow({ task, view }: { task: Task; view: HandoffView }) {
  const [busy, setBusy] = React.useState(false);
  const handOff = async () => {
    setBusy(true);
    await handOffTask(task);
    setBusy(false);
  };
  switch (view.kind) {
    case 'off':
    case 'linking':
      return (
        <Button
          variant='secondary'
          className='self-start'
          loading={busy || view.kind === 'linking'}
          onClick={() => void handOff()}
        >
          {HANDOFF_TITLE}
        </Button>
      );
    case 'failed':
      return (
        <>
          <p role='alert' className='selectable text-destructive text-xs'>
            {view.message}
          </p>
          <div className='flex gap-2'>
            <Button variant='secondary' onClick={() => void removeHandoff(task)}>
              {HANDOFF_REMOVE}
            </Button>
            <Button variant='secondary' loading={busy} onClick={() => void handOff()}>
              Try again
            </Button>
          </div>
        </>
      );
    case 'ready':
      return (
        <div className='flex gap-2'>
          <CopyLinkButton url={view.url} label={HANDOFF_COPY} />
          <Button variant='secondary' onClick={() => void removeHandoff(task)}>
            Turn off link
          </Button>
        </div>
      );
    case 'claimed':
      return (
        <div className='flex min-w-0 items-center gap-3'>
          <HandoffGuest view={view} />
          <Button variant='secondary' onClick={() => openHandoffRemoveConfirm(task.id)}>
            {HANDOFF_REMOVE}
          </Button>
        </div>
      );
  }
}

function HandoffSection({ task }: { task: Task }) {
  const supported = useEngineCommand('task.hand_off', task.id);
  if (!(supported && canHandOff(task))) return null;
  const view = resolveHandoffView(task);
  return (
    <>
      <Separator />
      <section aria-label={HANDOFF_TITLE} className='flex w-full flex-col gap-2 text-start'>
        <div className='flex flex-col gap-px'>
          <h3 className='font-medium text-fg-4 text-sm'>{HANDOFF_TITLE}</h3>
          <p className='text-fg-3 text-xs'>
            {view.kind === 'claimed' ? describeHandoffClaim(view.guest) : HANDOFF_DESCRIPTION}
          </p>
        </div>
        <HandoffRow task={task} view={view} />
      </section>
    </>
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
      {view.kind !== 'unpaired' && <HandoffSection task={task} />}
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

export function HandoffRemoveConfirm() {
  const task = useTask(useHandoffRemoveConfirm());
  const confirming = React.useRef<Task | null>(null);
  if (task) confirming.current = task;
  const guest = confirming.current?.handoff?.guest;
  return (
    <ConfirmDialog
      control={{
        open: Boolean(task),
        onOpenChange: (open) => {
          if (!open) closeHandoffRemoveConfirm();
        },
        onOpenChangeComplete: () => undefined,
      }}
      title={guest ? `Remove ${describeUserName(guest)}?` : `${HANDOFF_REMOVE}?`}
      body={HANDOFF_REMOVE_DESCRIPTION}
      action={HANDOFF_REMOVE}
      onConfirm={() => {
        if (confirming.current) void removeHandoff(confirming.current);
      }}
    />
  );
}
