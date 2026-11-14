import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { RefreshButton } from '@/components/accounts/refresh-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { CHANGELOG_COPY, CHANGELOG_ICON, openChangelog, useChangelogAvailable } from '@/lib/changelog.ts';
import {
  type AppUpdatesActions,
  createAppUpdatesActions,
  selectAppUpdates,
  useAppUpdates,
} from '@/lib/connection/app-updates.ts';
import { type EngineStatus, resolveEngineView, useEngineFailure } from '@/lib/connection/engine.ts';
import { useServerHealth } from '@/lib/connection/health.ts';
import { useEngineFeature, useMachines } from '@/lib/connection/socket.ts';
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
  describeInstalling,
  describeStayLabel,
  describeUpdateStatus,
  type MachineUpdates,
  resolveMachineUpdates,
  UPDATE_CHANNEL_ITEMS,
  UPDATES_LABEL,
  UPDATES_SECTION,
} from '@/lib/updates.ts';
import {
  SETTING_ROW,
  SETTINGS_SUBHEADING,
  SettingsCard,
  SettingsEmpty,
  SettingsGroup,
  SettingsSection,
  TOKEN_TEXT,
} from './group.tsx';

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

function EngineRow({
  engine,
  detail,
  action,
}: {
  engine: EngineStatus;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={SETTING_ROW}>
      <RowText title={UPDATES_LABEL.engine} detail={detail}>
        <span className={TOKEN_TEXT}>{engine.version}</span>
        {engine.label && (
          <Truncate className={cn('min-w-0', TONE_TEXT[engine.tone])}>{engine.label}</Truncate>
        )}
      </RowText>
      {action}
    </div>
  );
}

function AppRow({
  app,
  actions,
  busy = false,
}: {
  app: { version: string; channel: UpdateChannel; update: DesktopUpdate };
  actions: Pick<UpdateActions, 'install' | 'answerDowngrade'>;
  busy?: boolean;
}) {
  const status = describeUpdateStatus(app.update);
  return (
    <div className={SETTING_ROW}>
      <RowText title={UPDATES_LABEL.app} detail={describeAppDetail(app.channel)}>
        <span className={TOKEN_TEXT}>{app.version}</span>
        {status && <Truncate className={cn('min-w-0', TONE_TEXT[status.tone])}>{status.label}</Truncate>}
      </RowText>
      {app.update.status === 'ready' && (
        <Button
          variant='secondary'
          size='sm'
          icon='IconArrowRotateClockwise'
          disabled={busy}
          onClick={actions.install}
        >
          {UPDATES_LABEL.restart}
        </Button>
      )}
      {app.update.status === 'downgrade' && (
        <div className='flex shrink-0 items-center gap-1'>
          <Button
            variant='secondary'
            size='sm'
            disabled={busy}
            onClick={() => actions.answerDowngrade(false)}
          >
            {describeStayLabel(app.version)}
          </Button>
          <Button
            variant='secondary'
            size='sm'
            icon='IconArrowDown'
            disabled={busy}
            onClick={() => actions.answerDowngrade(true)}
          >
            {UPDATES_LABEL.downgrade}
          </Button>
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  onChange,
}: {
  channel: UpdateChannel;
  onChange: (channel: UpdateChannel) => void;
}) {
  return (
    <div className={SETTING_ROW}>
      <RowText title={UPDATES_LABEL.channel} detail={describeChannelDetail(channel)} />
      <SelectField<UpdateChannel>
        label={UPDATES_LABEL.channel}
        items={UPDATE_CHANNEL_ITEMS}
        value={channel}
        onValueChange={onChange}
      />
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
  app: { version: string; channel: UpdateChannel; update: DesktopUpdate };
  engine?: EngineStatus | null;
  changelog?: boolean;
  actions: UpdateActions;
}) {
  return (
    <SettingsGroup
      title={UPDATES_SECTION}
      description={UPDATES_LABEL.agents}
      action={<RefreshButton label={UPDATES_LABEL.check} onRefresh={async () => actions.check()} />}
    >
      <AppRow app={app} actions={actions} />
      {engine && <EngineRow engine={engine} />}
      <ChannelRow channel={app.channel} onChange={actions.changeChannel} />
      {changelog && <ChangelogRow />}
    </SettingsGroup>
  );
}

function resolveEngineStatus(version: string, older = false): EngineStatus {
  return older
    ? { version, label: UPDATES_LABEL.olderEngine, tone: 'orange' }
    : { version, label: '', tone: 'neutral' };
}

function MachineRows({
  updates,
  actions,
  busy,
}: {
  updates: MachineUpdates;
  actions: AppUpdatesActions;
  busy: boolean;
}) {
  switch (updates.kind) {
    case 'outdated':
      return <SettingsEmpty>{UPDATES_LABEL.outdated}</SettingsEmpty>;
    case 'reading':
      return (
        <div className={SETTING_ROW}>
          <LoadingLine label={UPDATES_LABEL.reading} className='text-xs' />
        </div>
      );
    case 'failed':
      return <SettingsEmpty>{updates.message}</SettingsEmpty>;
    case 'standalone':
      return <EngineRow engine={resolveEngineStatus(updates.engine)} detail={UPDATES_LABEL.standalone} />;
    case 'not_running':
    case 'installing':
      return (
        <>
          <div className={SETTING_ROW}>
            <RowText
              title={UPDATES_LABEL.app}
              detail={
                updates.kind === 'installing'
                  ? UPDATES_LABEL.installingDetail
                  : UPDATES_LABEL.notRunningDetail
              }
            >
              {updates.app && <span className={TOKEN_TEXT}>{updates.app}</span>}
              {updates.kind === 'installing' ? (
                <Truncate className='min-w-0'>{describeInstalling(updates.version)}</Truncate>
              ) : (
                <Truncate className={cn('min-w-0', TONE_TEXT.orange)}>{UPDATES_LABEL.notRunning}</Truncate>
              )}
            </RowText>
            {updates.kind === 'not_running' && (
              <Button variant='secondary' size='sm' disabled={busy} onClick={() => void actions.open()}>
                {UPDATES_LABEL.open}
              </Button>
            )}
          </div>
          <EngineRow engine={resolveEngineStatus(updates.engine)} />
        </>
      );
    case 'running':
      return (
        <>
          <AppRow app={updates.app} actions={actions} busy={busy} />
          <EngineRow
            engine={resolveEngineStatus(updates.engine, updates.restartEngine)}
            action={
              updates.restartEngine && (
                <Button
                  variant='secondary'
                  size='sm'
                  icon='IconArrowRotateClockwise'
                  disabled={busy}
                  onClick={() => void actions.restartEngine()}
                >
                  {UPDATES_LABEL.restartEngine}
                </Button>
              )
            }
          />
          <ChannelRow
            channel={updates.app.channel}
            onChange={(channel) => void actions.changeChannel(channel)}
          />
        </>
      );
  }
}

export function MachineUpdatesCard({
  name,
  updates,
  actions,
  busy = false,
}: {
  name: string | null;
  updates: MachineUpdates;
  actions: AppUpdatesActions;
  busy?: boolean;
}) {
  return (
    <SettingsCard>
      {name && <div className={SETTINGS_SUBHEADING}>{name}</div>}
      <MachineRows updates={updates} actions={actions} busy={busy} />
    </SettingsCard>
  );
}

function MachineUpdates({ machineId, name }: { machineId: string | null; name: string | null }) {
  const supported = useEngineFeature('app-updates', machineId);
  const view = useAppUpdates(machineId, supported);
  const actions = React.useMemo(() => createAppUpdatesActions(machineId), [machineId]);
  return (
    <MachineUpdatesCard
      name={name}
      updates={resolveMachineUpdates(view, supported)}
      actions={actions}
      busy={view.busy !== null}
    />
  );
}

function BrowserUpdateSettings() {
  const listed = useMachines();
  const changelog = useChangelogAvailable();
  const machines = React.useMemo(
    () => listed.filter((machine) => !machine.member).map(({ id, name }) => ({ id, name })),
    [listed]
  );
  const reached = machines.length > 0 ? machines : [{ id: null, name: null }];
  const checkAll = async () => {
    const running = reached.filter((machine) => selectAppUpdates(machine.id).answer?.running);
    await Promise.all(running.map((machine) => createAppUpdatesActions(machine.id).check()));
  };
  return (
    <SettingsSection
      title={UPDATES_SECTION}
      description={UPDATES_LABEL.agents}
      action={<RefreshButton label={UPDATES_LABEL.check} onRefresh={checkAll} />}
    >
      {reached.map((machine) => (
        <MachineUpdates key={machine.id ?? ''} machineId={machine.id} name={machine.name} />
      ))}
      {changelog && (
        <SettingsCard>
          <ChangelogRow />
        </SettingsCard>
      )}
    </SettingsSection>
  );
}

export function UpdateSettings() {
  return selectDesktopBuild() ? <DesktopUpdateSettings /> : <BrowserUpdateSettings />;
}

function DesktopUpdateSettings() {
  const update = React.useSyncExternalStore(subscribeDesktopUpdate, readDesktopUpdate);
  const channel = React.useSyncExternalStore(subscribeDesktopUpdate, readDesktopChannel);
  const build = selectDesktopBuild();
  const health = useServerHealth();
  const failure = useEngineFailure();
  const engine = resolveEngineView(build, health, failure).status;
  const changelog = useChangelogAvailable();
  if (!(build && channel)) return null;
  const app = { version: build.version, channel, update };
  return <UpdatesGroup app={app} engine={engine} changelog={changelog} actions={UPDATE_ACTIONS} />;
}
