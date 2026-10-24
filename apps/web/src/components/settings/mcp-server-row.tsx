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
  needsConnect,
  resolveCostText,
  resolveServerCost,
  resolveServerCostHint,
  resolveServerDetail,
  type ServerDialogTarget,
  SWITCH_LABEL,
} from '@/lib/extensions.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { SETTING_ROW, TOKEN_TEXT } from './group.tsx';
import { ServerMenu } from './mcp-server-menu.tsx';

interface RowProps {
  server: McpServerSummary;
  snapshot: ExtensionsSnapshot;
  places: ExtensionPlaces;
  now: number;
}

function ToolName({ name, description }: { name: string; description: string | null }) {
  const text = <span className='min-w-0 cursor-default truncate font-mono text-fg-3 text-xs'>{name}</span>;
  if (!description) return text;
  return <Hint label={description}>{text}</Hint>;
}

function ServerDetail({ server, snapshot, places, now }: RowProps) {
  const detail = resolveServerDetail(server, snapshot, places, now);
  return (
    <div className='flex flex-col gap-1.5 pr-2 pb-2.5 pl-7'>
      {detail.error && <p className={cn('break-words text-2xs', TONE_TEXT.red)}>{detail.error}</p>}
      {detail.tools.length > 0 && (
        <ul className='grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-1'>
          {detail.tools.map((tool) => (
            <li key={tool.name} className='flex min-w-0'>
              <ToolName name={tool.name} description={tool.description} />
            </li>
          ))}
        </ul>
      )}
      {detail.empty && <p className='text-2xs text-fg-2'>{detail.empty}</p>}
      <Hint label={detail.target}>
        <span className='min-w-0 cursor-default truncate text-2xs text-fg-2'>{detail.line}</span>
      </Hint>
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
