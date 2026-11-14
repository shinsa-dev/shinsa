import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { RefreshButton } from '@/components/accounts/refresh-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { CHANGELOG_COPY, CHANGELOG_ICON, openChangelog, useChangelogAvailable } from '@/lib/changelog.ts';
import { type EngineStatus, resolveEngineView, useEngineFailure } from '@/lib/connection/engine.ts';
import { useServerHealth } from '@/lib/connection/health.ts';
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
  describeAppDetail,
  describeChannelDetail,
  describeStayLabel,
  describeUpdateStatus,
  UPDATE_CHANNEL_ITEMS,
  UPDATES_LABEL,
  UPDATES_SECTION,
} from '@/lib/updates.ts';
import { SETTING_ROW, SettingsGroup, TOKEN_TEXT } from './group.tsx';

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

function RowText({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className='flex min-w-0 flex-1 flex-col'>
      <div className='flex min-w-0 items-center gap-1.5 text-xs'>
        <span className='shrink-0 text-fg-4'>{title}</span>
        {children}
      </div>
      {detail && <Truncate className='text-2xs text-fg-2'>{detail}</Truncate>}
    </div>
  );
}

function EngineRow({ engine }: { engine: EngineStatus }) {
  return (
    <div className={SETTING_ROW}>
      <RowText title={UPDATES_LABEL.engine}>
        <span className={TOKEN_TEXT}>{engine.version}</span>
        <Truncate className={cn('min-w-0', TONE_TEXT[engine.tone])}>{engine.label}</Truncate>
      </RowText>
    </div>
  );
}

function ChangelogRow() {
  return (
    <div className={SETTING_ROW}>
      <RowText title={CHANGELOG_COPY.row} detail={CHANGELOG_COPY.rowDetail} />
      <Button variant='secondary' size='sm' icon={CHANGELOG_ICON} onClick={() => openChangelog()}>
        {CHANGELOG_COPY.open}
      </Button>
    </div>
  );
}

export function UpdatesGroup({
  app,
  engine = null,
  changelog = false,
  actions,
}: {
  app: { version: string; channel: UpdateChannel; update: DesktopUpdate } | null;
  engine?: EngineStatus | null;
  changelog?: boolean;
  actions: UpdateActions;
}) {
  if (!app) {
    if (!changelog) return null;
    return (
      <SettingsGroup title={UPDATES_SECTION}>
        <ChangelogRow />
      </SettingsGroup>
    );
  }
  const status = describeUpdateStatus(app.update);
  return (
    <SettingsGroup
      title={UPDATES_SECTION}
      description={UPDATES_LABEL.agents}
      action={<RefreshButton label={UPDATES_LABEL.check} onRefresh={async () => actions.check()} />}
    >
      <div className={SETTING_ROW}>
        <RowText title={UPDATES_LABEL.app} detail={describeAppDetail(app.channel)}>
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
      {engine && <EngineRow engine={engine} />}
      <div className={SETTING_ROW}>
        <RowText title={UPDATES_LABEL.channel} detail={describeChannelDetail(app.channel)} />
        <SelectField<UpdateChannel>
          label={UPDATES_LABEL.channel}
          items={UPDATE_CHANNEL_ITEMS}
          value={app.channel}
          onValueChange={actions.changeChannel}
        />
      </div>
      {changelog && <ChangelogRow />}
    </SettingsGroup>
  );
}

export function UpdateSettings() {
  const update = React.useSyncExternalStore(subscribeDesktopUpdate, readDesktopUpdate);
  const channel = React.useSyncExternalStore(subscribeDesktopUpdate, readDesktopChannel);
  const build = selectDesktopBuild();
  const health = useServerHealth();
  const failure = useEngineFailure();
  const app = build && channel ? { version: build.version, channel, update } : null;
  const engine = resolveEngineView(build, health, failure).status;
  const changelog = useChangelogAvailable();
  return <UpdatesGroup app={app} engine={engine} changelog={changelog} actions={UPDATE_ACTIONS} />;
}
