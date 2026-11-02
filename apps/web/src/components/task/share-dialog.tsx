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
import { MentionText, UserIdentity } from '@/components/people/user-tag.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { useShinsaSelector, useTask } from '@/lib/connection/selectors.ts';
import { useEngineCommand } from '@/lib/connection/socket.ts';
import { formatSince } from '@/lib/format/time.ts';
import { type Mention, resolveFirstName } from '@/lib/remote/users.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import {
  changeShareLimit,
  changeSharePreset,
  closeShareDialog,
  closeUnshareConfirm,
  listShareLimitItems,
  listShareModeItems,
  openUnshareConfirm,
  resolveShareLimitChoice,
  resolveShareModeChoice,
  resolveSharePresetChoice,
  resolveShareView,
  SHARE_DESCRIPTION,
  SHARE_LIMIT_TITLE,
  SHARE_NEEDS_REMOTE,
  SHARE_PRESET_TITLE,
  SHARE_TITLE,
  type ShareMode,
  type ShareView,
  selectLiveShare,
  shareTask,
  UNSHARE_DESCRIPTION,
  UNSHARE_TITLE,
  unshareTask,
  useShareDialog,
  useShareDialogFocus,
  useUnshareConfirm,
} from '@/lib/share/dialog.ts';
import {
  closeHandoffRemoveConfirm,
  describeHandoffClaim,
  HANDOFF_COPY,
  HANDOFF_DESCRIPTION,
  HANDOFF_HELD_DESCRIPTION,
  HANDOFF_JOINED,
  HANDOFF_REMOVE,
  HANDOFF_REMOVE_DESCRIPTION,
  HANDOFF_TITLE,
  HANDOFF_TURN_OFF,
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

function ShareModeRow({
  items,
  mode,
  onChange,
}: {
  items: ReturnType<typeof listShareModeItems>;
  mode: ShareMode;
  onChange: (mode: ShareMode) => void;
}) {
  return (
    <Field className='w-full'>
      <FieldLabel>{SHARE_PRESET_TITLE}</FieldLabel>
      <SelectField
        label={SHARE_PRESET_TITLE}
        align='start'
        className='w-full'
        items={items}
        value={mode}
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
  return (
    <UserIdentity
      user={view.guest}
      className='w-full'
      detail={<TimeAgo at={view.at} text={(now) => formatSince(HANDOFF_JOINED, view.at, now)} />}
    />
  );
}

function HandoffBody({ view }: { view: HandoffView }) {
  if (view.kind === 'failed')
    return (
      <p role='alert' className='selectable text-destructive text-xs'>
        {view.message}
      </p>
    );
  if (view.kind === 'claimed') return <HandoffGuest view={view} />;
  return null;
}

function HandoffActions({ task, view }: { task: Task; view: HandoffView }) {
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
        <Button loading={busy || view.kind === 'linking'} onClick={() => void handOff()}>
          {HANDOFF_TITLE}
        </Button>
      );
    case 'failed':
      return (
        <>
          <Button variant='secondary' onClick={() => void removeHandoff(task)}>
            {HANDOFF_REMOVE}
          </Button>
          <Button loading={busy} onClick={() => void handOff()}>
            Try again
          </Button>
        </>
      );
    case 'ready':
      return (
        <>
          <Button variant='secondary' onClick={() => void removeHandoff(task)}>
            {HANDOFF_TURN_OFF}
          </Button>
          <CopyLinkButton url={view.url} label={HANDOFF_COPY} />
          <Button onClick={closeShareDialog}>Done</Button>
        </>
      );
    case 'claimed':
      return (
        <>
          <Button variant='secondary' onClick={() => openHandoffRemoveConfirm(task.id)}>
            {HANDOFF_REMOVE}
          </Button>
          <Button onClick={closeShareDialog}>Done</Button>
        </>
      );
  }
}

function describeHandoffView(view: HandoffView): Mention {
  if (view.kind === 'claimed') return [...describeHandoffClaim(view.guest), `. ${HANDOFF_HELD_DESCRIPTION}`];
  return [HANDOFF_DESCRIPTION];
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
  const handoffSupported = useEngineCommand('task.hand_off', task.id);
  const [pickedMode, setPickedMode] = React.useState<ShareMode | null>(null);
  const focus = useShareDialogFocus();
  const mode = pickedMode ?? resolveShareModeChoice(task, settings, handoffSupported, focus);
  const preset = mode === 'handoff' ? resolveSharePresetChoice(task, settings) : mode;
  const handing = mode === 'handoff' && view.kind !== 'unpaired';
  const handoff = resolveHandoffView(task);
  const pickLimit = (next: ShareLimit) => {
    if (shared) void changeShareLimit(task, next);
    else setPicked(next);
  };
  const pickMode = (next: ShareMode) => {
    setPickedMode(next);
    if (next !== 'handoff' && live && shared && next !== live.preset) void changeSharePreset(task, next);
  };
  const shownMode = mode === 'handoff' || !(shared && live) ? mode : live.preset;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{SHARE_TITLE}</DialogTitle>
        <DialogDescription>
          {handing ? <MentionText mention={describeHandoffView(handoff)} /> : SHARE_DESCRIPTION}
        </DialogDescription>
      </DialogHeader>
      {!handing && <ShareBody view={view} />}
      {view.kind !== 'unpaired' && (
        <>
          <ShareModeRow
            items={listShareModeItems(task, handoffSupported)}
            mode={shownMode}
            onChange={pickMode}
          />
          {handing ? (
            <HandoffBody view={handoff} />
          ) : (
            <ShareLimitRow task={task} limit={shared && live ? live.limit : limit} onChange={pickLimit} />
          )}
        </>
      )}
      <DialogFooter>
        {handing ? (
          <HandoffActions task={task} view={handoff} />
        ) : (
          <ShareActions task={task} view={view} limit={limit} preset={preset} />
        )}
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
      title={guest ? `Remove ${resolveFirstName(guest)}?` : `${HANDOFF_REMOVE}?`}
      body={HANDOFF_REMOVE_DESCRIPTION}
      action={HANDOFF_REMOVE}
      onConfirm={() => {
        if (confirming.current) void removeHandoff(confirming.current);
      }}
    />
  );
}
