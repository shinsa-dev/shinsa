import type {
  AccessRequest,
  LinkKind,
  RemoteAccess,
  RemoteDevice,
  RemoteLink,
  RemoteMember,
  RemoteSnapshot,
  RemoteUser,
} from '@shinsa/core';
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
import { Truncate } from '@shinsa/ui/components/truncate';
import { type DialogControl, useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { requestWithToast } from '@/lib/connection/commands.ts';
import {
  REMOTE_ACCESS_ACTIONS,
  type RemoteAccessActions,
  useRemoteAccess,
} from '@/lib/connection/remote-access.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveOnMachineUrl, THIS_MACHINE } from '@/lib/remote/mode.ts';
import { describeUserName } from '@/lib/remote/users.ts';
import {
  canEnrollDevices,
  describeAcceptOutcome,
  describeAccessRequest,
  describeDeviceDetail,
  describeLinkAge,
  describeMemberSince,
  describeRemoteStatus,
  LINK_COPY,
  REMOTE_ACCESS_SECTION,
  resolveQrImage,
  selectLink,
} from '@/lib/remote-access.ts';
import { ROW_INSET, SETTING_ROW, SettingsEmpty, SettingsGroup } from './group.tsx';
import { UserRow } from './user-row.tsx';

const NO_MEMBERS: RemoteMember[] = [];

const DESCRIPTION =
  'Reach this machine from any device through Shinsa Cloud, behind GitHub sign-in and end to end encrypted. Each device, a browser or a phone, asks for access with a link and opens nothing until you accept it. Invite someone to give them the same control with their own GitHub account.';

const SUBHEADING = `mt-1.5 border-border border-t pt-2.5 pb-0.5 text-2xs text-fg-2 first:mt-0 first:border-t-0 first:pt-1.5 ${ROW_INSET}`;

const ONLY_YOU = `pt-0.5 pb-1.5 text-fg-2 text-xs ${ROW_INSET}`;

function QrCode({ text }: { text: string }) {
  const image = React.useMemo(() => resolveQrImage(text), [text]);
  return <img src={image} alt='QR code for the link' className='size-48 rounded-md' />;
}

function LinkView({ link, now }: { link: RemoteLink; now: number }) {
  return (
    <div className='flex w-full flex-col items-center gap-3'>
      <QrCode text={link.url} />
      <div className='flex w-full min-w-0 items-center gap-1.5'>
        <Truncate className='min-w-0 flex-1 font-mono text-2xs text-fg-2'>{link.url}</Truncate>
        <CopyButton text={link.url} />
      </div>
      <p className='text-2xs text-fg-2'>{describeLinkAge(link, now)}</p>
    </div>
  );
}

function LinkDialog({
  kind,
  control,
  link,
  canEnroll,
  actions,
}: {
  kind: LinkKind;
  control: DialogControl;
  link: RemoteLink | null;
  canEnroll: boolean;
  actions: RemoteAccessActions;
}) {
  const copy = LINK_COPY[kind];
  const [busy, setBusy] = React.useState(false);
  const now = useNow();

  async function run(act: () => Promise<unknown>, done?: string) {
    setBusy(true);
    await requestWithToast(act, done);
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{link ? copy.share : copy.intro}</DialogDescription>
        </DialogHeader>
        {link && <LinkView link={link} now={now} />}
        <DialogFooter>
          {link ? (
            <>
              <Button
                variant='secondary'
                disabled={busy}
                onClick={() =>
                  void run(() => actions.removeLink(kind), `The link is turned off. ${copy.off}`)
                }
              >
                Turn off link
              </Button>
              <Button
                variant='secondary'
                disabled={busy || !canEnroll}
                onClick={() => void run(() => actions.createLink(kind), `There is a new link. ${copy.off}`)}
              >
                Make new link
              </Button>
              {kind === 'device' && (
                <Button
                  variant='secondary'
                  nativeButton={false}
                  render={<a href={resolveOnMachineUrl(link.url)} target='_blank' rel='noreferrer' />}
                >
                  Add this device
                </Button>
              )}
              <DialogClose render={<Button />}>Done</DialogClose>
            </>
          ) : (
            <>
              <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
              <Button
                loading={busy}
                disabled={!canEnroll}
                onClick={() => void run(() => actions.createLink(kind))}
              >
                Make link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccessRequestRows({
  title = 'Waiting for your answer',
  requests,
  access,
  onAccept,
  onDecline,
}: {
  title?: string;
  requests: AccessRequest[];
  access: RemoteAccess | null;
  onAccept: (request: AccessRequest) => Promise<unknown>;
  onDecline: (request: AccessRequest) => Promise<unknown>;
}) {
  const now = useNow();
  if (requests.length === 0) return null;
  return (
    <>
      <p className={SUBHEADING}>{title}</p>
      {requests.map((request) => (
        <UserRow key={request.id} user={request.user} detail={describeAccessRequest(request, now)}>
          <Button
            variant='secondary'
            size='sm'
            onClick={() =>
              void requestWithToast(
                () => onDecline(request),
                `The request for ${request.deviceName} is declined.`
              )
            }
          >
            Decline
          </Button>
          <Button
            size='sm'
            onClick={() =>
              void requestWithToast(() => onAccept(request), describeAcceptOutcome(request, access))
            }
          >
            Accept
          </Button>
        </UserRow>
      ))}
    </>
  );
}

function StatusRow({
  snapshot,
  actions,
  onRemove,
}: {
  snapshot: RemoteSnapshot;
  actions: RemoteAccessActions;
  onRemove: () => void;
}) {
  const status = describeRemoteStatus(snapshot);
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex min-w-0 items-center gap-1.5 text-xs'>
          <span className='shrink-0 text-fg-4'>{THIS_MACHINE}</span>
          <span className='min-w-0 truncate text-fg-2'>{snapshot.machineName}</span>
          <span className={cn('shrink-0', TONE_TEXT[status.tone])}>{status.label}</span>
        </div>
        <Truncate className='text-2xs text-fg-2'>{status.detail}</Truncate>
      </div>
      <StatusActions snapshot={snapshot} actions={actions} onRemove={onRemove} />
    </div>
  );
}

function StatusActions({
  snapshot,
  actions,
  onRemove,
}: {
  snapshot: RemoteSnapshot;
  actions: RemoteAccessActions;
  onRemove: () => void;
}) {
  if (snapshot.pairing) {
    const { url } = snapshot.pairing;
    return (
      <div className='flex shrink-0 items-center gap-1.5'>
        <Button variant='secondary' size='sm' onClick={() => void requestWithToast(actions.cancelPairing)}>
          Cancel
        </Button>
        <Button size='sm' nativeButton={false} render={<a href={url} target='_blank' rel='noreferrer' />}>
          Open sign-in
        </Button>
      </div>
    );
  }
  if (!snapshot.paired)
    return (
      <Button size='sm' onClick={() => void requestWithToast(actions.pair)}>
        Turn on
      </Button>
    );
  return (
    <div className='flex shrink-0 items-center gap-1.5'>
      <Button variant='secondary' size='sm' onClick={onRemove}>
        Remove
      </Button>
      {snapshot.status !== 'revoked' &&
        (snapshot.enabled ? (
          <Button
            variant='secondary'
            size='sm'
            onClick={() => void requestWithToast(actions.pause, 'Remote access is paused.')}
          >
            Pause
          </Button>
        ) : (
          <Button
            size='sm'
            onClick={() => void requestWithToast(actions.resume, 'Remote access is on again.')}
          >
            Resume
          </Button>
        ))}
    </div>
  );
}

function DeviceRow({
  device,
  snapshot,
  onForget,
}: {
  device: RemoteDevice;
  snapshot: RemoteSnapshot;
  onForget: () => void;
}) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-fg-4 text-xs'>{device.name}</span>
        <span className='truncate text-2xs text-fg-2'>{describeDeviceDetail(device, snapshot.access)}</span>
      </div>
      <Button variant='secondary' size='sm' onClick={onForget}>
        Forget
      </Button>
    </div>
  );
}

function PeopleSection({
  owner,
  members,
  onRemove,
}: {
  owner: RemoteUser | null;
  members: RemoteMember[];
  onRemove: (user: RemoteUser) => void;
}) {
  return (
    <>
      <p className={SUBHEADING}>People who can reach this machine</p>
      {owner && <UserRow user={owner} detail='Owner' />}
      {members.length === 0 && (
        <p className={ONLY_YOU}>
          Only you. Invite someone to let them ask for full control of this machine with their own GitHub
          account.
        </p>
      )}
      {members.map((member) => (
        <UserRow key={member.user.id} user={member.user} detail={describeMemberSince(member)}>
          <Button variant='secondary' size='sm' onClick={() => onRemove(member.user)}>
            Remove
          </Button>
        </UserRow>
      ))}
    </>
  );
}

type RemoteDialog =
  | { kind: 'link'; link: LinkKind }
  | { kind: 'remove' }
  | { kind: 'forget'; device: RemoteDevice }
  | { kind: 'member'; user: RemoteUser };

function RemoteDialogs({
  dialog,
  snapshot,
  canEnroll,
  actions,
}: {
  dialog: ReturnType<typeof useDialogState<RemoteDialog>>;
  snapshot: RemoteSnapshot | null;
  canEnroll: boolean;
  actions: RemoteAccessActions;
}) {
  const { value } = dialog;
  if (value?.kind === 'link')
    return (
      <LinkDialog
        kind={value.link}
        control={dialog.control}
        link={selectLink(snapshot, value.link)}
        canEnroll={canEnroll}
        actions={actions}
      />
    );
  if (value?.kind === 'member') {
    const name = describeUserName(value.user);
    return (
      <ConfirmDialog
        control={dialog.control}
        title={`Remove ${name}?`}
        body={`@${value.user.login} can no longer reach this machine from Shinsa Cloud. Every device they added is forgotten, and any page they have open closes. Invite them again to give it back.`}
        action='Remove member'
        onConfirm={() =>
          void requestWithToast(
            () => actions.removeMember(value.user.id),
            `${name} no longer has access to this machine.`
          )
        }
      />
    );
  }
  if (value?.kind === 'forget')
    return (
      <ConfirmDialog
        control={dialog.control}
        title={`Forget ${value.device.name}?`}
        body='It can no longer open this machine from Shinsa Cloud, and any page it has open closes. Add it again to use it.'
        action='Forget device'
        onConfirm={() =>
          void requestWithToast(
            () => actions.forgetDevice(value.device.publicKey),
            `${value.device.name} is forgotten.`
          )
        }
      />
    );
  if (value?.kind === 'remove')
    return (
      <ConfirmDialog
        control={dialog.control}
        title='Remove remote access?'
        body='This machine leaves Shinsa Cloud, its tunnel is deleted and every added device is forgotten. You can turn it on again later.'
        action='Remove remote access'
        onConfirm={() => void requestWithToast(actions.remove, 'Remote access is removed.')}
      />
    );
  return null;
}

export function RemoteAccessGroup({
  snapshot,
  failure,
  actions = REMOTE_ACCESS_ACTIONS,
}: {
  snapshot: RemoteSnapshot | null;
  failure: string | null;
  actions?: RemoteAccessActions;
}) {
  const dialog = useDialogState<RemoteDialog>();
  const canAdd = snapshot?.paired === true && snapshot.status !== 'revoked';
  const canEnroll = canEnrollDevices(snapshot);
  return (
    <SettingsGroup
      title={REMOTE_ACCESS_SECTION}
      description={DESCRIPTION}
      action={
        canEnroll ? (
          <div className='flex items-center gap-1.5'>
            <Button
              variant='secondary'
              size='sm'
              icon='IconUserAdd'
              onClick={() => dialog.show({ kind: 'link', link: 'invite' })}
            >
              Invite someone
            </Button>
            <Button
              variant='secondary'
              size='sm'
              icon='IconPlusMedium'
              onClick={() => dialog.show({ kind: 'link', link: 'device' })}
            >
              Add device
            </Button>
          </div>
        ) : undefined
      }
    >
      {!snapshot && <SettingsEmpty>{failure ?? 'Reading remote access…'}</SettingsEmpty>}
      {snapshot && (
        <StatusRow snapshot={snapshot} actions={actions} onRemove={() => dialog.show({ kind: 'remove' })} />
      )}
      {canAdd && (
        <AccessRequestRows
          requests={snapshot.requests}
          access={snapshot.access}
          onAccept={(request) => actions.acceptRequest(request.id)}
          onDecline={(request) => actions.declineRequest(request.id)}
        />
      )}
      {canAdd && <p className={SUBHEADING}>Devices that can reach this machine</p>}
      {canAdd && snapshot.devices.length === 0 && (
        <SettingsEmpty>
          None yet. Add device makes the link the phone or browser you use away from this machine asks for
          access with.
        </SettingsEmpty>
      )}
      {snapshot?.devices.map((device) => (
        <DeviceRow
          key={device.publicKey}
          device={device}
          snapshot={snapshot}
          onForget={() => dialog.show({ kind: 'forget', device })}
        />
      ))}
      {canAdd && (
        <PeopleSection
          owner={snapshot.access?.owner ?? null}
          members={snapshot.access?.members ?? NO_MEMBERS}
          onRemove={(user) => dialog.show({ kind: 'member', user })}
        />
      )}
      <RemoteDialogs dialog={dialog} snapshot={snapshot} canEnroll={canEnroll} actions={actions} />
    </SettingsGroup>
  );
}

export function RemoteAccessSettings() {
  const { snapshot, failure } = useRemoteAccess();
  return <RemoteAccessGroup snapshot={snapshot} failure={failure} />;
}
