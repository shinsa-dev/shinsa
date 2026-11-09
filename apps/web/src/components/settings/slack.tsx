import type { SlackLinkUse, SlackSnapshot } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { SLACK_ACTIONS, type SlackActions, useSlack } from '@/lib/connection/slack.ts';
import { useGuestMachines, useMachines } from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  describeSlackLink,
  describeSlackStatus,
  resolveSlackConnectLabel,
  SLACK_DESCRIPTION,
  SLACK_SECTION,
} from '@/lib/slack.ts';
import { SETTING_ROW, SettingsEmpty, SettingsGroup } from './group.tsx';

function StatusAction({ snapshot, member }: { snapshot: SlackSnapshot; member: boolean }) {
  if (!snapshot.connectUrl) return null;
  const connected = snapshot.links.length > 0;
  return (
    <Button
      size='sm'
      variant={connected && !member ? 'secondary' : 'primary'}
      nativeButton={false}
      render={<a href={snapshot.connectUrl} target='_blank' rel='noreferrer' />}
    >
      {resolveSlackConnectLabel(connected, member)}
    </Button>
  );
}

function StatusRow({ snapshot, member }: { snapshot: SlackSnapshot; member: boolean }) {
  const status = describeSlackStatus(snapshot, member);
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex min-w-0 items-center gap-1.5 text-xs'>
          <span className='shrink-0 text-fg-4'>Slack</span>
          <span className={cn('shrink-0', TONE_TEXT[status.tone])}>{status.label}</span>
        </div>
        <p className='text-2xs text-pretty text-fg-2'>{status.detail}</p>
      </div>
      <StatusAction snapshot={snapshot} member={member} />
    </div>
  );
}

function LinkRow({ link }: { link: SlackLinkUse }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-xs text-fg-4'>{link.teamName}</span>
        <span className='truncate text-2xs text-fg-2'>{describeSlackLink(link)}</span>
      </div>
    </div>
  );
}

export function SlackGroup({
  snapshot,
  failure,
  member = false,
  actions = SLACK_ACTIONS,
}: {
  snapshot: SlackSnapshot | null;
  failure: string | null;
  member?: boolean;
  actions?: SlackActions;
}) {
  const dialog = useDialogState<true>();
  const connected = (snapshot?.links.length ?? 0) > 0;
  return (
    <SettingsGroup
      title={SLACK_SECTION}
      description={SLACK_DESCRIPTION}
      action={
        connected && !member ? (
          <Button variant='secondary' size='sm' onClick={() => dialog.show(true)}>
            Disconnect
          </Button>
        ) : undefined
      }
    >
      {!snapshot && <SettingsEmpty>{failure ?? 'Reading Slack…'}</SettingsEmpty>}
      {snapshot && <StatusRow snapshot={snapshot} member={member} />}
      {snapshot?.links.map((link) => (
        <LinkRow key={`${link.teamId}:${link.userId}`} link={link} />
      ))}
      <ConfirmDialog
        control={dialog.control}
        title='Disconnect Slack?'
        body='Mentions of @Shinsa stop reaching this machine. Tasks already started keep running, and you can connect again later.'
        action='Disconnect Slack'
        onConfirm={() => void requestWithToast(actions.disconnect, 'Slack is disconnected.')}
      />
    </SettingsGroup>
  );
}

function SlackReader({ member }: { member: boolean }) {
  const { snapshot, failure } = useSlack();
  return <SlackGroup snapshot={snapshot} failure={failure} member={member} />;
}

export function SlackSettings() {
  const machines = useMachines();
  const handed = useGuestMachines();
  const here = machines.find((machine) => machine.current) ?? machines[0];
  return machines.length === 0 && handed.length > 0 ? null : <SlackReader member={here?.member === true} />;
}
