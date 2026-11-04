import { CUSTOM_PRESET, type ShareLimit, type Task, type ViewScope } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Checkbox } from '@shinsa/ui/components/checkbox';
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
import { CopyLinkButton } from '@/components/controls/copy-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { MentionText, UserIdentity } from '@/components/people/user-tag.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { useSettings, useShinsaState, useTask } from '@/lib/connection/selectors.ts';
import { useEngineCommand, useEngineFeature } from '@/lib/connection/socket.ts';
import { formatSince } from '@/lib/format/time.ts';
import { type Mention, resolveFirstName } from '@/lib/remote/users.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import {
  changeShareLimit,
  changeShareScopes,
  closeShareDialog,
  closeUnshareConfirm,
  listShareLimitItems,
  listShareModeItems,
  listShareScopeRows,
  openUnshareConfirm,
  resolveShareLimitChoice,
  resolveShareModeChoice,
  resolveShareChoice,
  resolveShareChoiceScopes,
  resolveShareScopesChoice,
  resolveShareView,
  SHARE_DESCRIPTION,
  SHARE_LIMIT_TITLE,
  SHARE_NEEDS_REMOTE,
  SHARE_PRESET_TITLE,
  SHARE_SCOPES_TITLE,
  SHARE_TITLE,
  type ShareMode,
  type ShareView,
  selectLiveShare,
  shareTask,
  toggleShareScope,
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
  describeHandToTeammate,
  HANDOFF_COPY,
  HANDOFF_DESCRIPTION,
  HANDOFF_LINK,
  HANDOFF_TEAMMATE_DESCRIPTION,
  HANDOFF_TO_TITLE,
  type HandoffTeammate,
  handToTeammate,
  listHandoffTargetItems,
  listHandoffTeammates,
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
import { resolveShareSourceScopes } from '@/lib/share/scopes.ts';
import { navigate } from '@/router.ts';

function ShareBody({ view }: { view: ShareView }) {
  switch (view.kind) {
    case 'unpaired':
      return <p className='text-xs text-fg-3'>{SHARE_NEEDS_REMOTE}</p>;
    case 'off':
    case 'linking':
    case 'shared':
      return null;
    case 'failed':
      return (
        <p role='alert' className='selectable text-xs text-destructive'>
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

function ShareScopeCheck({
  row,
  checked,
  onToggle,
}: {
  row: ReturnType<typeof listShareScopeRows>[number];
  checked: boolean;
  onToggle: (scope: ViewScope, on: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className='flex min-w-0 items-start gap-2'>
      <Checkbox
        id={id}
        size='sm'
        className='mt-px'
        checked={checked}
        disabled={row.required}
        aria-label={row.title}
        onCheckedChange={(next) => onToggle(row.scope, next)}
      />
      <label htmlFor={id} className='flex min-w-0 flex-col gap-px'>
        <span className='text-xs text-fg-4'>{row.title}</span>
        <span className='text-2xs text-pretty text-fg-2'>{row.hint}</span>
      </label>
    </div>
  );
}

function ShareScopesRow({
  scopes,
  onChange,
}: {
  scopes: readonly ViewScope[];
  onChange: (scopes: readonly ViewScope[]) => void;
}) {
  return (
    <Field className='w-full'>
      <FieldLabel>{SHARE_SCOPES_TITLE}</FieldLabel>
      <div className='grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2'>
        {listShareScopeRows().map((row) => (
          <ShareScopeCheck
            key={row.scope}
            row={row}
            checked={scopes.includes(row.scope)}
            onToggle={(scope, on) => onChange(toggleShareScope(scopes, scope, on))}
          />
        ))}
      </div>
    </Field>
  );
}

function ShareActions({
  task,
  view,
  limit,
  scopes,
  scopesSupported,
}: {
  task: Task;
  view: ShareView;
  limit: ShareLimit;
  scopes: readonly ViewScope[];
  scopesSupported: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const share = async () => {
    setBusy(true);
    await shareTask(task, limit, scopes, scopesSupported);
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
      <p role='alert' className='selectable text-xs text-destructive'>
        {view.message}
      </p>
    );
  if (view.kind === 'claimed') return <HandoffGuest view={view} />;
  return null;
}

function HandoffTargetRow({
  teammates,
  target,
  onChange,
}: {
  teammates: readonly HandoffTeammate[];
  target: string;
  onChange: (target: string) => void;
}) {
  return (
    <Field className='w-full'>
      <FieldLabel>{HANDOFF_TO_TITLE}</FieldLabel>
      <SelectField
        label={HANDOFF_TO_TITLE}
        align='start'
        className='w-full'
        items={listHandoffTargetItems(teammates)}
        value={target}
        onValueChange={onChange}
      />
    </Field>
  );
}

function HandToTeammateAction({ task, teammate }: { task: Task; teammate: HandoffTeammate }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      loading={busy}
      onClick={() => {
        setBusy(true);
        void handToTeammate(task, teammate).then(() => {
          setBusy(false);
          closeShareDialog();
        });
      }}
    >
      {describeHandToTeammate(teammate.user)}
    </Button>
  );
}

function HandoffActions({
  task,
  view,
  teammate,
}: {
  task: Task;
  view: HandoffView;
  teammate: HandoffTeammate | null;
}) {
  const [busy, setBusy] = React.useState(false);
  const handOff = async () => {
    setBusy(true);
    await handOffTask(task);
    setBusy(false);
  };
  if (teammate && view.kind !== 'claimed') return <HandToTeammateAction task={task} teammate={teammate} />;
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

function describeHandoffView(view: HandoffView, teammate: HandoffTeammate | null): Mention {
  if (view.kind === 'claimed') return [...describeHandoffClaim(view.guest), `. ${HANDOFF_HELD_DESCRIPTION}`];
  return [teammate ? HANDOFF_TEAMMATE_DESCRIPTION : HANDOFF_DESCRIPTION];
}

function useHandoffTeammates(task: Task) {
  const state = useShinsaState();
  const { snapshot } = useRemoteAccess();
  const supported = useEngineCommand('task.hand_to_teammate', task.id);
  return React.useMemo(
    () => (state && supported ? listHandoffTeammates(state, task, snapshot) : []),
    [state, supported, task, snapshot]
  );
}

function ShareContent({ task }: { task: Task }) {
  const { snapshot } = useRemoteAccess();
  const settings = useSettings();
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
  const scopesSupported = useEngineFeature('share.scopes', task.id);
  const [pickedMode, setPickedMode] = React.useState<ShareMode | null>(null);
  const [pickedScopes, setPickedScopes] = React.useState<readonly ViewScope[] | null>(null);
  const focus = useShareDialogFocus();
  const scopes =
    shared && live
      ? resolveShareSourceScopes(live)
      : (pickedScopes ?? resolveShareScopesChoice(task, settings));
  const mode = pickedMode ?? resolveShareModeChoice(task, settings, handoffSupported, focus);
  const handing = mode === 'handoff' && view.kind !== 'unpaired';
  const handoff = resolveHandoffView(task);
  const teammates = useHandoffTeammates(task);
  const [target, setTarget] = React.useState(HANDOFF_LINK);
  const teammate = teammates.find((candidate) => candidate.user.id === target) ?? null;
  const picksTeammate = handing && handoff.kind !== 'claimed' && teammates.length > 0;
  const pickLimit = (next: ShareLimit) => {
    if (shared) void changeShareLimit(task, next);
    else setPicked(next);
  };
  const [customSeen, setCustomSeen] = React.useState(false);
  const pickScopes = (next: readonly ViewScope[]) => {
    if (resolveShareChoice(next) === CUSTOM_PRESET) setCustomSeen(true);
    setPickedMode(resolveShareChoice(next));
    if (shared) void changeShareScopes(task, next, scopesSupported);
    else setPickedScopes(next);
  };
  const pickMode = (next: ShareMode) => {
    if (next === 'handoff') setPickedMode(next);
    else pickScopes(resolveShareChoiceScopes(next, scopes));
  };
  const shownMode = mode === 'handoff' ? mode : resolveShareChoice(scopes);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{SHARE_TITLE}</DialogTitle>
        <DialogDescription>
          {handing ? <MentionText mention={describeHandoffView(handoff, teammate)} /> : SHARE_DESCRIPTION}
        </DialogDescription>
      </DialogHeader>
      {!handing && <ShareBody view={view} />}
      {view.kind !== 'unpaired' && (
        <>
          <ShareModeRow
            items={listShareModeItems(task, handoffSupported, customSeen || shownMode === CUSTOM_PRESET)}
            mode={shownMode}
            onChange={pickMode}
          />
          {!handing && scopesSupported && <ShareScopesRow scopes={scopes} onChange={pickScopes} />}
          {picksTeammate && <HandoffTargetRow teammates={teammates} target={target} onChange={setTarget} />}
          {handing ? (
            <HandoffBody view={handoff} />
          ) : (
            <ShareLimitRow task={task} limit={shared && live ? live.limit : limit} onChange={pickLimit} />
          )}
        </>
      )}
      <DialogFooter>
        {handing ? (
          <HandoffActions task={task} view={handoff} teammate={picksTeammate ? teammate : null} />
        ) : (
          <ShareActions
            task={task}
            view={view}
            limit={limit}
            scopes={scopes}
            scopesSupported={scopesSupported}
          />
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
