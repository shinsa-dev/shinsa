import { resolveServiceView, resolveTerminalLabel, type ServiceView, type TerminalInfo } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { Tabs, TabsList, TabsTrigger } from '@shinsa/ui/components/tabs';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { describeServiceState, SERVICE_GLYPHS } from '@/lib/terminal/services.ts';
import { describeTerminalTab, moveTerminal } from '@/lib/terminal/tabs.ts';

function RenameField({
  terminal,
  onDone,
}: {
  terminal: TerminalInfo;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = React.useState(resolveTerminalLabel(terminal));
  const finished = React.useRef(false);
  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(name);
  };
  return (
    <Input
      autoFocus
      value={value}
      aria-label='Terminal name'
      className='h-full w-40 text-xs'
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value);
        if (event.key === 'Escape') finish(terminal.name);
      }}
    />
  );
}

function TabMark({
  service,
  ended,
  active,
}: {
  service: ServiceView | null;
  ended: boolean;
  active: boolean;
}) {
  if (!service) return <Icon name={active ? 'IconConsoleFilled' : 'IconConsole'} size='sm' />;
  const glyph = SERVICE_GLYPHS[service.state];
  return (
    <Icon
      name={active ? glyph.activeIcon : glyph.icon}
      size='sm'
      className={cn(
        glyph.tone !== 'neutral' && TONE_TEXT[glyph.tone],
        ended && glyph.tone === 'neutral' && 'text-fg-2'
      )}
    />
  );
}

function TabLabel({
  label,
  detail,
  service,
  ended,
  active,
}: {
  label: string;
  detail: string;
  service: ServiceView | null;
  ended: boolean;
  active: boolean;
}) {
  return (
    <Hint label={label} detail={detail}>
      <span className={cn('flex w-fit min-w-0 items-center gap-1.5', ended && 'text-fg-2')}>
        <TabMark service={service} ended={ended} active={active} />
        <span className='truncate'>{label}</span>
      </span>
    </Hint>
  );
}

function ServiceTabLabel({
  label,
  service,
  now: fixed,
  ended,
  active,
}: {
  label: string;
  service: ServiceView;
  now: number | undefined;
  ended: boolean;
  active: boolean;
}) {
  const live = useNow();
  const now = fixed ?? live;
  const view = resolveServiceView(service.service, service.terminal, now);
  return (
    <TabLabel
      label={label}
      detail={`${describeServiceState(view, now)} · ${view.service.command}`}
      service={view}
      ended={ended}
      active={active}
    />
  );
}

function TerminalTab({
  terminal,
  service,
  now,
  active,
  dragging,
  onClose,
  onRename,
  onDragStart,
  onDrop,
}: {
  terminal: TerminalInfo;
  service: ServiceView | null;
  now: number | undefined;
  active: boolean;
  dragging: boolean;
  onClose: () => void;
  onRename: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const label = resolveTerminalLabel(terminal);
  const ended = terminal.status !== 'running';
  return (
    <TabsTrigger
      value={terminal.id}
      nativeButton={false}
      render={<div />}
      data-dragging={dragging || undefined}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onMouseDown={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onClose();
        }
      }}
      onDoubleClick={onRename}
      className='group/tab min-w-0 max-w-56 shrink-0 data-dragging:opacity-50 group-data-[variant=default]/tabs-list:pe-0.5'
    >
      {service ? (
        <ServiceTabLabel label={label} service={service} now={now} ended={ended} active={active} />
      ) : (
        <TabLabel
          label={label}
          detail={describeTerminalTab(terminal)}
          service={null}
          ended={ended}
          active={active}
        />
      )}
      <Hint label='Close terminal'>
        <Button
          variant='secondary'
          size='icon-2xs'
          icon='IconCrossSmall'
          aria-label='Close terminal'
          className={cn('opacity-0 group-hover/tab:opacity-100', active && 'opacity-100')}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        />
      </Hint>
    </TabsTrigger>
  );
}

export function TerminalTabs({
  terminals,
  services,
  now,
  activeId,
  renamingId,
  onSelect,
  onClose,
  onRenameStart,
  onRename,
  onReorder,
}: {
  terminals: TerminalInfo[];
  services: ServiceView[];
  now?: number;
  activeId: string | null;
  renamingId: string | null;
  onSelect: (terminal: TerminalInfo) => void;
  onClose: (terminal: TerminalInfo) => void;
  onRenameStart: (terminal: TerminalInfo) => void;
  onRename: (terminal: TerminalInfo, name: string | null) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [dragged, setDragged] = React.useState<string | null>(null);
  const ids = terminals.map((terminal) => terminal.id);
  return (
    <Tabs
      value={activeId}
      onValueChange={(id) => {
        const terminal = terminals.find((candidate) => candidate.id === id);
        if (terminal) onSelect(terminal);
      }}
      className='min-w-0 flex-1'
    >
      <TabsList aria-label='Terminals' className='max-w-full justify-start overflow-x-auto'>
        {terminals.map((terminal) =>
          terminal.id === renamingId ? (
            <RenameField key={terminal.id} terminal={terminal} onDone={(name) => onRename(terminal, name)} />
          ) : (
            <TerminalTab
              key={terminal.id}
              terminal={terminal}
              service={services.find((view) => view.terminal?.id === terminal.id) ?? null}
              now={now}
              active={terminal.id === activeId}
              dragging={terminal.id === dragged}
              onClose={() => onClose(terminal)}
              onRename={() => onRenameStart(terminal)}
              onDragStart={() => setDragged(terminal.id)}
              onDrop={() => {
                if (dragged) onReorder(moveTerminal(ids, dragged, terminal.id));
                setDragged(null);
              }}
            />
          )
        )}
      </TabsList>
    </Tabs>
  );
}
