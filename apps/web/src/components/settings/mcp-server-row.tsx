import type { ExtensionsSnapshot, McpServerSummary } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Switch } from '@shinsa/ui/components/switch';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SectionChevron } from '@/components/layout/page/section-label.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import type { ExtensionActions } from '@/lib/connection/extensions.ts';
import {
  describeServerPlaces,
  describeServerSources,
  describeServerToggled,
  EXTENSION_LABEL,
  type ExtensionPlaces,
  isPluginOff,
  listServerNotes,
  needsConnect,
  resolveCostText,
  resolveServerCost,
  resolveServerCostHint,
  resolveServerStatus,
  resolveServerTarget,
  type ServerDialogTarget,
  SWITCH_LABEL,
} from '@/lib/extensions.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { SETTING_ROW, SETTINGS_SHELF, TOKEN_TEXT } from './group.tsx';
import { ServerMenu } from './mcp-server-menu.tsx';

const DETAIL_ROW = cn(SETTING_ROW, 'gap-1.5 text-2xs text-fg-2');

interface RowProps {
  server: McpServerSummary;
  snapshot: ExtensionsSnapshot;
  places: ExtensionPlaces;
  now: number;
}

function ServerDetail({ server, snapshot, places, now }: RowProps) {
  const status = resolveServerStatus(server);
  const { tools } = server.status;
  return (
    <div className={cn(SETTINGS_SHELF, 'mb-1')}>
      <div className={DETAIL_ROW}>
        <Truncate className='min-w-0 flex-1 font-mono'>{resolveServerTarget(server)}</Truncate>
      </div>
      <div className={cn(DETAIL_ROW, 'flex-wrap gap-x-3')}>
        {listServerNotes(server, snapshot, places, now).map((note) => (
          <span key={note} className='min-w-0'>
            {note}
          </span>
        ))}
      </div>
      {status?.tone === 'red' && status.detail && (
        <div className={cn(DETAIL_ROW, TONE_TEXT.red)}>
          <span className='min-w-0 flex-1 break-words'>{status.detail}</span>
        </div>
      )}
      {tools.length > 0 && (
        <ul className='flex flex-col gap-1.5 py-2 pr-1.5 pl-2'>
          {tools.map((tool) => (
            <li key={tool.name} className='flex min-w-0 flex-col gap-px'>
              <span className='truncate font-mono text-fg-4 text-xs'>{tool.name}</span>
              {tool.description && <Truncate className='text-2xs text-fg-2'>{tool.description}</Truncate>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ServerCost({ server, snapshot }: Pick<RowProps, 'server' | 'snapshot'>) {
  const text = resolveCostText(server, resolveServerCost(server, snapshot.plugins));
  const hint = resolveServerCostHint(server);
  if (!hint) return <span className={cn(TOKEN_TEXT, 'hidden sm:inline')}>{text}</span>;
  return (
    <Hint label={hint}>
      <span className={cn(TOKEN_TEXT, 'hidden cursor-default sm:inline')}>{text}</span>
    </Hint>
  );
}

function ServerSwitch({
  server,
  snapshot,
  actions,
}: Pick<RowProps, 'server' | 'snapshot'> & { actions: ExtensionActions }) {
  const blocked = isPluginOff(snapshot.plugins, server.plugin);
  return (
    <Hint label={EXTENSION_LABEL.switchHint}>
      <Switch
        checked={server.enabled && !blocked}
        disabled={blocked}
        aria-label={SWITCH_LABEL.servers(server.name)}
        onCheckedChange={(enabled) =>
          void actions.choose(server, { enabled }, describeServerToggled(server.name, enabled))
        }
      />
    </Hint>
  );
}

export function McpServerRow({
  actions,
  onOpen,
  ...props
}: RowProps & { actions: ExtensionActions; onOpen: (target: ServerDialogTarget) => void }) {
  const { server, snapshot, places } = props;
  const [open, setOpen] = React.useState(false);
  const toggle = () => setOpen((value) => !value);
  return (
    <div className='flex flex-col'>
      <div className={cn(SETTING_ROW, 'gap-1.5')}>
        <button
          type='button'
          aria-expanded={open}
          aria-label={`${open ? EXTENSION_LABEL.hideDetails : EXTENSION_LABEL.details}: ${server.name}`}
          onClick={toggle}
          className='flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-xs transition-colors hover:text-fg-4 active:text-fg-4'
        >
          <SectionChevron open={open} className='shrink-0' />
          <Truncate className='min-w-0 shrink-0 font-medium text-fg-4'>{server.name}</Truncate>
          <Hint label={describeServerPlaces(server)}>
            <span className='min-w-0 truncate text-fg-2'>
              {describeServerSources(server, snapshot.plugins)}
            </span>
          </Hint>
        </button>
        <ServerCost server={server} snapshot={snapshot} />
        {needsConnect(server) && (
          <Button size='xs' onClick={() => void actions.signIn(server)}>
            {EXTENSION_LABEL.connect}
          </Button>
        )}
        <ServerSwitch server={server} snapshot={snapshot} actions={actions} />
        <ServerMenu
          server={server}
          places={places}
          actions={actions}
          detailsOpen={open}
          onToggleDetails={toggle}
          onOpen={onOpen}
        />
      </div>
      {open && <ServerDetail {...props} />}
    </div>
  );
}
