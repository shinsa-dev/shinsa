import type {
  AccessRequest,
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
import { MentionText } from '@/components/people/user-tag.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { requestWithToast } from '@/lib/connection/commands.ts';
import {
  type MachineAccessActions,
  REMOTE_ACCESS_ACTIONS,
  type RemoteAccessActions,
  useRemoteAccess,
} from '@/lib/connection/remote-access.ts';
import { formatSince } from '@/lib/format/time.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  canEnrollDevices,
  describeAcceptOutcome,
  describeAccessRequest,
  describeDeviceDetail,
  describeMemberSince,
  describeRemoteStatus,
  LINK_COPY,
  REMOTE_ACCESS_SECTION,
  resolveQrImage,
} from '@/lib/remote-access.ts';
import { THIS_MACHINE } from '@/lib/remote/mode.ts';
import { resolveFirstName } from '@/lib/remote/users.ts';
import { SETTING_ROW, SETTINGS_SUBHEADING, SettingsCard, SettingsEmpty, SettingsGroup } from './group.tsx';
import { UserRow } from './user-row.tsx';

const NO_MEMBERS: readonly RemoteMember[] = [];

const DESCRIPTION =
  'Reach this machine from any device through Shinsa Cloud, behind GitHub sign-in and end to end encrypted. Your devices and other people ask for access with the invite link, and nothing opens until you accept.';

function QrCode({ text }: { text: string }) {
  const image = React.useMemo(() => resolveQrImage(text), [text]);
  return <img src={image} alt='QR code for the link' className='size-48 rounded-md' />;
}

export function LinkView({ url }: { url: string }) {
  return (
    <div className='flex w-full flex-col items-center gap-3'>
      <QrCode text={url} />
      <div className='flex w-full min-w-0 items-center gap-1.5'>
        <Truncate className='min-w-0 flex-1 font-mono text-2xs text-fg-2'>{url}</Truncate>
        <CopyButton text={url} />
      </div>
    </div>
  );
}

function LinkDialog({
  control,
  link,
  canEnroll,
  actions,
}: {
  control: DialogControl;
  link: RemoteLink | null;
  canEnroll: boolean;
  actions: MachineAccessActions;
}) {
  const [busy, setBusy] = React.useState(false);

  async function run(act: () => Promise<unknown>, done?: string) {
    setBusy(true);
    await requestWithToast(act, done);
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{LINK_COPY.title}</DialogTitle>
          <DialogDescription>{link ? LINK_COPY.share : LINK_COPY.intro}</DialogDescription>
        </DialogHeader>
        {link && <LinkView url={link.url} />}
        <DialogFooter>
          {link ? (
            <>
              <Button
                variant='secondary'
                disabled={busy}
                onClick={() => void run(actions.removeLink, 'The link is off.')}
              >
                Turn off link
              </Button>
              <DialogClose render={<Button />}>Done</DialogClose>
            </>
          ) : (
            <>
              <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
              <Button loading={busy} disabled={!canEnroll} onClick={() => void run(actions.createLink)}>
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
  viewerId,
  onAccept,
  onDecline,
}: {
  title?: string;
  requests: AccessRequest[];
  access: RemoteAccess | null;
  viewerId: string | null;
  onAccept: (request: AccessRequest) => Promise<unknown>;
  onDecline: (request: AccessRequest) => Promise<unknown>;
}) {
  const now = useNow();
  if (requests.length === 0) return null;
  return (
    <>
      <p className={SETTINGS_SUBHEADING}>{title}</p>
      {requests.map((request) => {
        const answers = (
          <>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => void requestWithToast(() => onDecline(request), 'Request declined.')}
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
          </>
        );
        if (request.user.id === viewerId)
          return (
            <div key={request.id} className={SETTING_ROW}>
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-xs text-fg-4'>{request.deviceName}</span>
                <span className='truncate text-2xs text-fg-2'>
                  {formatSince('Asked', request.requestedAt, now)}
                </span>
              </div>
              {answers}
            </div>
          );
        return (
          <UserRow key={request.id} user={request.user} detail={describeAccessRequest(request, now)}>
            {answers}
          </UserRow>
        );
      })}
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
        <Truncate className='text-2xs text-fg-2'>
          <MentionText mention={status.detail} />
        </Truncate>
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
  onRevoke,
}: {
  device: RemoteDevice;
  snapshot: RemoteSnapshot;
  onRevoke: () => void;
}) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-xs text-fg-4'>{device.name}</span>
        <span className='truncate text-2xs text-fg-2'>
          <MentionText mention={describeDeviceDetail(device, snapshot.access)} />
        </span>
      </div>
      <Button variant='secondary' size='sm' onClick={onRevoke}>
        Revoke
      </Button>
    </div>
  );
}

function PeopleSection({
  place,
  owner,
  members,
  onRemove,
}: {
  place: string;
  owner: RemoteUser | null;
  members: readonly RemoteMember[];
  onRemove: (user: RemoteUser) => void;
}) {
  return (
    <>
      <p className={SETTINGS_SUBHEADING}>{`People who can reach ${place}`}</p>
      {owner && <UserRow user={owner} detail='Owner' self />}
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
  | { kind: 'link' }
  | { kind: 'remove' }
  | { kind: 'revoke'; device: RemoteDevice }
  | { kind: 'member'; user: RemoteUser };

function RemoteDialogs({
  dialog,
  snapshot,
  place,
  canEnroll,
  actions,
  onRemove,
}: {
  dialog: ReturnType<typeof useDialogState<RemoteDialog>>;
  snapshot: RemoteSnapshot | null;
  place: string;
  canEnroll: boolean;
  actions: MachineAccessActions;
  onRemove?: () => Promise<unknown>;
}) {
  const { value } = dialog;
  if (value?.kind === 'link')
    return (
      <LinkDialog
        control={dialog.control}
        link={snapshot?.link ?? null}
        canEnroll={canEnroll}
        actions={actions}
      />
    );
  if (value?.kind === 'member') {
    const name = resolveFirstName(value.user);
    return (
      <ConfirmDialog
        control={dialog.control}
        title={`Remove ${name}?`}
        body={`${name} can no longer reach ${place} from Shinsa Cloud. Every device they added is revoked, and any page they have open closes. They can ask for access again with the invite link.`}
        action='Remove member'
        onConfirm={() =>
          void requestWithToast(() => actions.removeMember(value.user.id), `${name} was removed.`)
        }
      />
    );
  }
  if (value?.kind === 'revoke')
    return (
      <ConfirmDialog
        control={dialog.control}
        title={`Revoke ${value.device.name}?`}
        body={`It can no longer open ${place} from Shinsa Cloud, and any page it has open closes. It can ask for access again with the invite link.`}
        action='Revoke device'
        onConfirm={() =>
          void requestWithToast(() => actions.revokeDevice(value.device.publicKey), 'Device revoked.')
        }
      />
    );
  if (value?.kind === 'remove' && onRemove)
    return (
      <ConfirmDialog
        control={dialog.control}
        title='Remove remote access?'
        body='This machine leaves Shinsa Cloud, its tunnel is deleted and every added device is revoked. You can turn it on again later.'
        action='Remove remote access'
        onConfirm={() => void requestWithToast(onRemove, 'Remote access is removed.')}
      />
    );
  return null;
}

function InviteLinkButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant='secondary' size='sm' icon='IconUserAdd' onClick={onClick}>
      Invite link
    </Button>
  );
}

function AccessBody({
  snapshot,
  place,
  actions,
  onDialog,
}: {
  snapshot: RemoteSnapshot;
  place: string;
  actions: MachineAccessActions;
  onDialog: (dialog: RemoteDialog) => void;
}) {
  return (
    <>
      <AccessRequestRows
        requests={snapshot.requests}
        access={snapshot.access}
        viewerId={snapshot.access?.owner.id ?? null}
        onAccept={(request) => actions.acceptRequest(request.id)}
        onDecline={(request) => actions.declineRequest(request.id)}
      />
      <p className={SETTINGS_SUBHEADING}>{`Devices that can reach ${place}`}</p>
      {snapshot.devices.length === 0 && (
        <SettingsEmpty>
          {`None yet. Open the invite link on the phone or browser you use away from ${place} to ask for access.`}
        </SettingsEmpty>
      )}
      {snapshot.devices.map((device) => (
        <DeviceRow
          key={device.publicKey}
          device={device}
          snapshot={snapshot}
          onRevoke={() => onDialog({ kind: 'revoke', device })}
        />
      ))}
      <PeopleSection
        place={place}
        owner={snapshot.access?.owner ?? null}
        members={snapshot.access?.members ?? NO_MEMBERS}
        onRemove={(user) => onDialog({ kind: 'member', user })}
      />
    </>
  );
}

const LOCAL_PLACE = 'this machine';

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
      action={canEnroll ? <InviteLinkButton onClick={() => dialog.show({ kind: 'link' })} /> : undefined}
    >
      {!snapshot && <SettingsEmpty>{failure ?? 'Reading remote access…'}</SettingsEmpty>}
      {snapshot && (
        <StatusRow snapshot={snapshot} actions={actions} onRemove={() => dialog.show({ kind: 'remove' })} />
      )}
      {canAdd && (
        <AccessBody snapshot={snapshot} place={LOCAL_PLACE} actions={actions} onDialog={dialog.show} />
      )}
      <RemoteDialogs
        dialog={dialog}
        snapshot={snapshot}
        place={LOCAL_PLACE}
        canEnroll={canEnroll}
        actions={actions}
        onRemove={actions.remove}
      />
    </SettingsGroup>
  );
}

export const MACHINE_ACCESS_DESCRIPTION =
  'Who can reach each machine through Shinsa Cloud, and from which devices. Pausing, removing or pairing it again is done on the machine itself.';

export function MachineAccessCard({
  name,
  snapshot,
  actions,
}: {
  name: string;
  snapshot: RemoteSnapshot;
  actions: MachineAccessActions;
}) {
  const dialog = useDialogState<RemoteDialog>();
  const canEnroll = canEnrollDevices(snapshot);
  return (
    <SettingsCard>
      <div className={SETTING_ROW}>
        <Truncate className='min-w-0 flex-1 text-xs font-medium text-fg-4'>{name}</Truncate>
        {canEnroll && <InviteLinkButton onClick={() => dialog.show({ kind: 'link' })} />}
      </div>
      <AccessBody snapshot={snapshot} place={name} actions={actions} onDialog={dialog.show} />
      <RemoteDialogs
        dialog={dialog}
        snapshot={snapshot}
        place={name}
        canEnroll={canEnroll}
        actions={actions}
      />
    </SettingsCard>
  );
}

export function RemoteAccessSettings() {
  const { snapshot, failure } = useRemoteAccess();
  return <RemoteAccessGroup snapshot={snapshot} failure={failure} />;
}
