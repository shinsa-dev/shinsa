import type { ExtensionsSnapshot, McpServerSummary } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { RefreshButton } from '@/components/accounts/refresh-button.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import type { ExtensionActions } from '@/lib/connection/extensions.ts';
import {
  describeServerRemoval,
  EXTENSION_LABEL,
  EXTENSION_SECTION,
  type ExtensionPlaces,
  isServerGroupOpen,
  listServerStatusGroups,
  resolveCurrentServer,
  type ServerDialogTarget,
} from '@/lib/extensions.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { FoldingBlock, ROW_INSET, SettingsEmpty, SettingsGroup } from './group.tsx';
import { McpServerRow } from './mcp-server-row.tsx';
import { ServerDialog } from './server-dialog.tsx';

type ServerDialogs = ReturnType<typeof useDialogState<ServerDialogTarget>>;

interface HostProps {
  dialog: ServerDialogs;
  snapshot: ExtensionsSnapshot;
  places: ExtensionPlaces;
  actions: ExtensionActions;
}

function ProblemRow({ problem }: { problem: string }) {
  return (
    <div className='flex min-h-8 items-start gap-1.5 py-1.5 pr-1.5 pl-2 text-2xs text-fg-3'>
      <Icon size='sm' name='IconExclamationTriangle' className='mt-px text-orange-text' />
      <span className='min-w-0'>{problem}</span>
    </div>
  );
}

function ServerDialogHost({ dialog, snapshot, places, actions }: HostProps) {
  const target = dialog.value;
  if (!target) return null;
  const dialogProps = { control: dialog.control, plugins: snapshot.plugins, places };
  if (target.mode === 'add') {
    return <ServerDialog {...dialogProps} mode='add' server={null} onSave={actions.add} />;
  }
  const server = resolveCurrentServer(snapshot.servers, target.server);
  if (target.mode === 'remove') {
    const removal = describeServerRemoval(server);
    return (
      <ConfirmDialog
        control={dialog.control}
        title={removal.title}
        body={removal.body}
        action={removal.action}
        onConfirm={() => void actions.remove(server)}
      />
    );
  }
  return (
    <ServerDialog
      {...dialogProps}
      mode={target.mode}
      server={server}
      onSave={(input, done) => actions.update(server, input, done)}
    />
  );
}

function useAddRequest(adding: boolean, dialog: ServerDialogs, onAddOpened?: () => void) {
  const { show } = dialog;
  React.useEffect(() => {
    if (!adding) return;
    show({ mode: 'add', server: null });
    onAddOpened?.();
  }, [adding, show, onAddOpened]);
}

export function McpServersGroup({
  snapshot,
  servers = snapshot.servers,
  places,
  actions,
  adding = false,
  onAddOpened,
  now = Date.now(),
  searching = false,
}: {
  snapshot: ExtensionsSnapshot;
  servers?: McpServerSummary[];
  searching?: boolean;
  places: ExtensionPlaces;
  actions: ExtensionActions;
  adding?: boolean;
  onAddOpened?: () => void;
  now?: number;
}) {
  const dialog = useDialogState<ServerDialogTarget>();
  useAddRequest(adding, dialog, onAddOpened);
  return (
    <SettingsGroup
      title={EXTENSION_SECTION.servers}
      className='gap-1.5'
      action={
        <>
          {snapshot.servers.length > 0 && (
            <RefreshButton label={EXTENSION_LABEL.checkAll} onRefresh={() => actions.check(null)} />
          )}
          <Button
            variant='secondary'
            size='sm'
            icon='IconPlusMedium'
            onClick={() => dialog.show({ mode: 'add', server: null })}
          >
            {EXTENSION_LABEL.addServer}
          </Button>
        </>
      }
    >
      {snapshot.problems.map((problem) => (
        <ProblemRow key={problem} problem={problem} />
      ))}
      {snapshot.servers.length === 0 && <SettingsEmpty>{EXTENSION_LABEL.noServers}</SettingsEmpty>}
      {listServerStatusGroups(servers, snapshot.plugins).map((group) => (
        <FoldingBlock
          key={group.key}
          persistId={createDisclosureId('settings', 'mcp', 'group', group.key)}
          title={group.title}
          detail={String(group.servers.length)}
          status={group}
          startsOpen={isServerGroupOpen(group)}
          forcedOpen={searching}
        >
          {group.servers.map((server) => (
            <McpServerRow
              key={server.id}
              server={server}
              snapshot={snapshot}
              places={places}
              actions={actions}
              now={now}
              onOpen={dialog.show}
            />
          ))}
        </FoldingBlock>
      ))}
      <ServerDialogHost dialog={dialog} snapshot={snapshot} places={places} actions={actions} />
    </SettingsGroup>
  );
}
