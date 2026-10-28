import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { RefreshButton } from '@/components/accounts/refresh-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import {
  answerDesktopDowngrade,
  applyDesktopChannel,
  checkDesktopUpdates,
  type DesktopUpdate,
  installDesktopUpdate,
  readDesktopChannel,
  readDesktopUpdate,
  selectDesktopBuild,
  subscribeDesktopUpdate,
  type UpdateChannel,
} from '@/lib/desktop.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  CANARY_DOWNLOAD_URL,
  describeAppDetail,
  describeChannelDetail,
  describeStayLabel,
  describeUpdateStatus,
  isChannelFixed,
  resolveAppName,
  resolveChannelItem,
  UPDATE_CHANNEL_ITEMS,
  UPDATES_LABEL,
  UPDATES_SECTION,
} from '@/lib/updates.ts';
import { SETTING_ROW, SettingsEmpty, SettingsGroup, TOKEN_TEXT } from './group.tsx';

export interface UpdateActions {
  check: () => void;
  install: () => void;
  changeChannel: (channel: UpdateChannel) => void;
  answerDowngrade: (accept: boolean) => void;
}

const UPDATE_ACTIONS: UpdateActions = {
  check: checkDesktopUpdates,
  install: installDesktopUpdate,
  changeChannel: applyDesktopChannel,
  answerDowngrade: answerDesktopDowngrade,
};

function RowText({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className='flex min-w-0 flex-1 flex-col'>
      <div className='flex min-w-0 items-center gap-1.5 text-xs'>
        <span className='shrink-0 text-fg-4'>{title}</span>
        {children}
      </div>
      <Truncate className='text-2xs text-fg-2'>{detail}</Truncate>
    </div>
  );
}

function FixedChannel({ channel }: { channel: UpdateChannel }) {
  const item = resolveChannelItem(channel);
  return (
    <span className='flex shrink-0 items-center gap-1.5 text-fg-4 text-xs'>
      <Icon size='sm' name={item.icon} />
      {item.label}
    </span>
  );
}

export function UpdatesGroup({
  app,
  actions,
}: {
  app: { version: string; channel: UpdateChannel; update: DesktopUpdate } | null;
  actions: UpdateActions;
}) {
  if (!app) {
    return (
      <SettingsGroup title={UPDATES_SECTION}>
        <SettingsEmpty>{UPDATES_LABEL.browser}</SettingsEmpty>
      </SettingsGroup>
    );
  }
  const status = describeUpdateStatus(app.update);
  return (
    <SettingsGroup
      title={UPDATES_SECTION}
      action={<RefreshButton label={UPDATES_LABEL.check} onRefresh={async () => actions.check()} />}
    >
      <div className={SETTING_ROW}>
        <RowText title={resolveAppName(app.channel)} detail={describeAppDetail(app.channel)}>
          <span className={TOKEN_TEXT}>{app.version}</span>
          {status && <Truncate className={cn('min-w-0', TONE_TEXT[status.tone])}>{status.label}</Truncate>}
        </RowText>
        {app.update.status === 'ready' && (
          <Button variant='secondary' size='sm' icon='IconArrowRotateClockwise' onClick={actions.install}>
            {UPDATES_LABEL.restart}
          </Button>
        )}
        {app.update.status === 'downgrade' && (
          <div className='flex shrink-0 items-center gap-1'>
            <Button variant='secondary' size='sm' onClick={() => actions.answerDowngrade(false)}>
              {describeStayLabel(app.version)}
            </Button>
            <Button
              variant='secondary'
              size='sm'
              icon='IconArrowDown'
              onClick={() => actions.answerDowngrade(true)}
            >
              {UPDATES_LABEL.downgrade}
            </Button>
          </div>
        )}
      </div>
      <div className={SETTING_ROW}>
        <RowText title={UPDATES_LABEL.channel} detail={describeChannelDetail(app.channel)} />
        {isChannelFixed(app.channel) ? (
          <FixedChannel channel={app.channel} />
        ) : (
          <SelectField<UpdateChannel>
            label={UPDATES_LABEL.channel}
            items={UPDATE_CHANNEL_ITEMS}
            value={app.channel}
            onValueChange={actions.changeChannel}
          />
        )}
      </div>
      {!isChannelFixed(app.channel) && (
        <div className={SETTING_ROW}>
          <RowText title={UPDATES_LABEL.canaryApp} detail={UPDATES_LABEL.canaryOffer} />
          <Button
            variant='secondary'
            size='sm'
            icon={{ name: 'IconArrowUpRight', position: 'inline-end' }}
            nativeButton={false}
            render={<a href={CANARY_DOWNLOAD_URL} target='_blank' rel='noreferrer' />}
          >
            {UPDATES_LABEL.downloadCanary}
          </Button>
        </div>
      )}
    </SettingsGroup>
  );
}

export function UpdateSettings() {
  const update = React.useSyncExternalStore(subscribeDesktopUpdate, readDesktopUpdate);
  const channel = React.useSyncExternalStore(subscribeDesktopUpdate, readDesktopChannel);
  const build = selectDesktopBuild();
  const app = build && channel ? { version: build.version, channel, update } : null;
  return <UpdatesGroup app={app} actions={UPDATE_ACTIONS} />;
}
