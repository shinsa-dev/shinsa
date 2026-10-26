import { resolveTerminalLabel, type ServiceView, type TerminalInfo } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { describeServiceState, SERVICE_GLYPHS } from '@/lib/terminal/services.ts';
import { describeTerminalTab, moveTerminal } from '@/lib/terminal/tabs.ts';

const TAB =
  'group/tab corner-superellipse/1.125 relative flex h-7 min-w-0 max-w-56 shrink-0 items-center gap-1.5 rounded-control ps-2 pe-0.75 text-fg-3 text-xs outline-none hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4 data-[active=true]:bg-bg-a2 data-[active=true]:text-fg-4 data-[active=true]:faux-medium data-[dragging=true]:opacity-50';

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
      className='h-6 w-40 text-xs'
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

function TabMark({ service, ended }: { service: ServiceView | null; ended: boolean }) {
  if (!service) return <Icon name='IconConsole' size='sm' />;
  const glyph = SERVICE_GLYPHS[service.state];
  return (
    <Icon
      name={glyph.icon}
      size='sm'
      className={cn(
        glyph.tone !== 'neutral' && TONE_TEXT[glyph.tone],
        ended && glyph.tone === 'neutral' && 'text-fg-2'
      )}
    />
  );
}

function TerminalTab({
  terminal,
  service,
  now,
  active,
  dragging,
  onSelect,
  onClose,
  onRename,
  onDragStart,
  onDrop,
}: {
  terminal: TerminalInfo;
  service: ServiceView | null;
  now: number;
  active: boolean;
  dragging: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const label = resolveTerminalLabel(terminal);
  const ended = terminal.status !== 'running';
  return (
    <div
      role='tab'
      tabIndex={0}
      aria-selected={active}
      data-active={active}
      data-dragging={dragging}
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
      onClick={onSelect}
      onDoubleClick={onRename}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
      className={TAB}
    >
      <Hint
        label={label}
        detail={
          service
            ? `${describeServiceState(service, now)} · ${service.service.command}`
            : describeTerminalTab(terminal)
        }
      >
        <span className={cn('flex w-fit min-w-0 items-center gap-1.5', ended && 'text-fg-2')}>
          <TabMark service={service} ended={ended} />
          <span className='truncate'>{label}</span>
        </span>
      </Hint>
      <Hint label='Close terminal'>
        <Button
          variant='secondary'
          size='icon-xs'
          icon='IconCrossSmall'
          aria-label='Close terminal'
          className={cn('opacity-0 group-hover/tab:opacity-100', active && 'opacity-100')}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        />
      </Hint>
    </div>
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
  now: number;
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
    <div
      role='tablist'
      aria-label='Terminals'
      className='flex min-w-0 flex-1 items-center gap-px overflow-x-auto'
    >
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
            onSelect={() => onSelect(terminal)}
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
    </div>
  );
}
