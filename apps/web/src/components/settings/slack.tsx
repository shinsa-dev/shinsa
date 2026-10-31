import type { ShinsaState, SlackLink, SlackSnapshot } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import { SelectField } from '@/components/controls/select-field.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { SLACK_ACTIONS, type SlackActions, useSlack } from '@/lib/connection/slack.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { REMOTE_ACCESS_SECTION } from '@/lib/remote-access.ts';
import { updateSettings } from '@/lib/settings.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import {
  describeSlackLink,
  describeSlackStatus,
  listSlackProjectItems,
  parseSlackProjectValue,
  resolveSlackProjectValue,
  SLACK_DESCRIPTION,
  SLACK_SECTION,
} from '@/lib/slack.ts';
import { navigate } from '@/router.ts';
import { SETTING_ROW, SettingRow, SettingsEmpty, SettingsGroup } from './group.tsx';

function StatusAction({ snapshot }: { snapshot: SlackSnapshot }) {
  if (!snapshot.remote)
    return (
      <Button
        variant='secondary'
        size='sm'
        onClick={() => navigate(resolveSettingsPath('general', REMOTE_ACCESS_SECTION))}
      >
        Open remote access
      </Button>
    );
  if (!snapshot.connectUrl) return null;
  const connected = snapshot.links.length > 0;
  return (
    <Button
      size='sm'
      variant={connected ? 'secondary' : 'primary'}
      nativeButton={false}
      render={<a href={snapshot.connectUrl} target='_blank' rel='noreferrer' />}
    >
      {connected ? 'Connect another workspace' : 'Connect Slack'}
    </Button>
  );
}

function StatusRow({ snapshot }: { snapshot: SlackSnapshot }) {
  const status = describeSlackStatus(snapshot);
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex min-w-0 items-center gap-1.5 text-xs'>
          <span className='shrink-0 text-fg-4'>Slack</span>
          <span className={cn('shrink-0', TONE_TEXT[status.tone])}>{status.label}</span>
        </div>
        <p className='text-pretty text-2xs text-fg-2'>{status.detail}</p>
      </div>
      <StatusAction snapshot={snapshot} />
    </div>
  );
}

function LinkRow({ link }: { link: SlackLink }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-fg-4 text-xs'>{link.teamName}</span>
        <span className='truncate text-2xs text-fg-2'>{describeSlackLink(link)}</span>
      </div>
    </div>
  );
}

export function SlackGroup({
  state,
  snapshot,
  failure,
  actions = SLACK_ACTIONS,
}: {
  state: ShinsaState;
  snapshot: SlackSnapshot | null;
  failure: string | null;
  actions?: SlackActions;
}) {
  const dialog = useDialogState<true>();
  const connected = (snapshot?.links.length ?? 0) > 0;
  return (
    <SettingsGroup
      title={SLACK_SECTION}
      description={SLACK_DESCRIPTION}
      action={
        connected ? (
          <Button variant='secondary' size='sm' onClick={() => dialog.show(true)}>
            Disconnect
          </Button>
        ) : undefined
      }
    >
      {!snapshot && <SettingsEmpty>{failure ?? 'Reading Slack…'}</SettingsEmpty>}
      {snapshot && <StatusRow snapshot={snapshot} />}
      {snapshot?.links.map((link) => (
        <LinkRow key={`${link.teamId}:${link.userId}`} link={link} />
      ))}
      {snapshot?.remote && (
        <SettingRow title='Project for new tasks'>
          <SelectField
            label='Project for new tasks'
            items={listSlackProjectItems(state)}
            value={resolveSlackProjectValue(state)}
            onValueChange={(value) =>
              void updateSettings(
                { slackProjectId: parseSlackProjectValue(value) },
                'Slack tasks go there now.'
              )
            }
          />
        </SettingRow>
      )}
      <ConfirmDialog
        control={dialog.control}
        title='Disconnect Slack?'
        body='Mentions of @Shinsa from your Slack accounts stop reaching this machine. Tasks already started keep running here, and you can connect again later.'
        action='Disconnect Slack'
        onConfirm={() => void requestWithToast(actions.disconnect, 'Slack is disconnected.')}
      />
    </SettingsGroup>
  );
}

export function SlackSettings({ state }: { state: ShinsaState }) {
  const { snapshot, failure } = useSlack();
  return <SlackGroup state={state} snapshot={snapshot} failure={failure} />;
}
