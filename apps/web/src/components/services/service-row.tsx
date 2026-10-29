import { isServiceActive, type Project, type ServiceView } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import type { IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { LIST_ROW, LIST_ROW_LINES, LIST_ROW_META, LIST_ROW_TITLE } from '@/components/layout/list-row.tsx';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  describeServicePreview,
  describeServiceState,
  SERVICE_GLYPHS,
  selectServicePreview,
  type TaskServiceRun,
} from '@/lib/terminal/services.ts';

export interface ServiceHandlers {
  start: (view: ServiceView) => void;
  stop: (view: ServiceView) => void;
  restart: (view: ServiceView) => void;
  startAll: (project: Project) => void;
  open: (view: ServiceView, project: Project) => void;
  preview: (view: ServiceView) => void;
}

const REVEAL = 'opacity-0 group-data-hovered/service:opacity-100';

const TREE_LINE = 'pointer-events-none absolute start-3.75 w-px bg-bg-a4';

export function ServiceActionButton({
  label,
  detail,
  icon,
  size = 'icon-sm',
  variant = 'secondary',
  onClick,
}: {
  label: string;
  detail?: string;
  icon: IconName;
  size?: 'icon-xs' | 'icon-sm';
  variant?: 'secondary' | 'bare';
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <Hint label={label} detail={detail}>
      <Button variant={variant} size={size} icon={icon} aria-label={label} onClick={onClick} />
    </Hint>
  );
}

export function ServicePreviewButton({
  view,
  label = null,
  size = 'icon-sm',
  onPreview,
}: {
  view: ServiceView;
  label?: string | null;
  size?: 'icon-xs' | 'icon-sm';
  onPreview: () => void;
}) {
  const url = selectServicePreview(view);
  if (!url) return null;
  return (
    <ServiceActionButton
      label={describeServicePreview(view, label)}
      detail={url}
      icon='IconArrowUpRight'
      size={size}
      onClick={(event) => {
        event.stopPropagation();
        onPreview();
      }}
    />
  );
}

export function ServiceRunButtons({
  view,
  size = 'icon-sm',
  onStart,
  onStop,
  onRestart,
  onPreview,
}: {
  view: ServiceView;
  size?: 'icon-xs' | 'icon-sm';
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onPreview: () => void;
}) {
  const name = view.service.name;
  if (!isServiceActive(view))
    return <ServiceActionButton label={`Start ${name}`} icon='IconPlay' size={size} onClick={onStart} />;
  return (
    <>
      <ServicePreviewButton view={view} size={size} onPreview={onPreview} />
      <ServiceActionButton
        label={`Restart ${name}`}
        icon='IconArrowRotateClockwise'
        size={size}
        onClick={onRestart}
      />
      <ServiceActionButton label={`Stop ${name}`} icon='IconStop' size={size} onClick={onStop} />
    </>
  );
}

export function ServiceRow({
  view,
  project,
  now,
  handlers,
  hasRuns = false,
}: {
  view: ServiceView;
  project: Project;
  now: number;
  handlers: ServiceHandlers;
  hasRuns?: boolean;
}) {
  const glyph = SERVICE_GLYPHS[view.state];
  const state = describeServiceState(view, now);
  const name = view.service.name;
  return (
    <div
      data-highlight-item=''
      className='group/service relative flex items-center gap-1 rounded-control pe-1'
    >
      {hasRuns && <span aria-hidden className={cn(TREE_LINE, 'top-7.5 bottom-0')} />}
      <button
        type='button'
        disabled={!view.terminal}
        aria-label={view.terminal ? `Open the terminal of ${name}` : name}
        onClick={() => handlers.open(view, project)}
        className={cn(LIST_ROW, LIST_ROW_LINES, 'min-w-0 flex-1 ps-1.5 disabled:cursor-default')}
      >
        <StatusTile icon={glyph.icon} tone={glyph.tone} label={state} />
        <ServiceLines view={view} now={now} />
      </button>
      <RowRunButtons view={view} handlers={handlers} />
    </div>
  );
}

function RowRunButtons({
  view,
  label = null,
  handlers,
}: {
  view: ServiceView;
  label?: string | null;
  handlers: ServiceHandlers;
}) {
  const name = view.service.name;
  if (!isServiceActive(view))
    return (
      <ServiceActionButton label={`Start ${name}`} icon='IconPlay' onClick={() => handlers.start(view)} />
    );
  return (
    <span className='flex shrink-0 items-center gap-px'>
      <span className={cn('flex items-center gap-px', REVEAL)}>
        <ServiceActionButton
          label={`Restart ${name}`}
          icon='IconArrowRotateClockwise'
          onClick={() => handlers.restart(view)}
        />
        <ServiceActionButton label={`Stop ${name}`} icon='IconStop' onClick={() => handlers.stop(view)} />
      </span>
      <ServicePreviewButton view={view} label={label} onPreview={() => handlers.preview(view)} />
    </span>
  );
}

export function TaskRunRow({
  run,
  last,
  project,
  now,
  handlers,
}: {
  run: TaskServiceRun;
  last: boolean;
  project: Project;
  now: number;
  handlers: ServiceHandlers;
}) {
  const { view, label } = run;
  const glyph = SERVICE_GLYPHS[view.state];
  const state = describeServiceState(view, now);
  return (
    <div
      data-highlight-item=''
      className='group/service relative flex items-center gap-1 rounded-control ps-6 pe-1'
    >
      <span aria-hidden className={cn(TREE_LINE, 'top-0', last ? 'h-1/2' : 'bottom-0')} />
      <span aria-hidden className='pointer-events-none absolute start-3.75 top-1/2 h-px w-2.5 bg-bg-a4' />
      <button
        type='button'
        aria-label={`Open the terminal of ${view.service.name} for ${label}`}
        onClick={() => handlers.open(view, project)}
        className={cn(LIST_ROW, 'h-8 min-w-0 flex-1 items-center ps-1.5')}
      >
        <StatusTile icon={glyph.icon} tone={glyph.tone} size='sm' label={state} />
        <Truncate className='min-w-0 flex-1 text-fg-3 text-xs'>{label}</Truncate>
        <span
          className={cn('shrink-0 text-2xs', glyph.tone === 'neutral' ? 'text-fg-2' : TONE_TEXT[glyph.tone])}
        >
          {state}
        </span>
      </button>
      <RowRunButtons view={view} label={label} handlers={handlers} />
    </div>
  );
}

function ServiceLines({ view, now }: { view: ServiceView; now: number }) {
  const glyph = SERVICE_GLYPHS[view.state];
  return (
    <span className='flex min-w-0 flex-1 flex-col gap-px'>
      <Truncate className={LIST_ROW_TITLE}>{view.service.name}</Truncate>
      <Truncate className={LIST_ROW_META}>
        <span className={cn(glyph.tone !== 'neutral' && TONE_TEXT[glyph.tone])}>
          {describeServiceState(view, now)}
        </span>
        {' · '}
        <span className='font-mono'>{view.service.command}</span>
      </Truncate>
    </span>
  );
}

export function ManagedServiceRow({
  view,
  now,
  picked,
  onPick,
  onEdit,
}: {
  view: ServiceView;
  now: number;
  picked: boolean;
  onPick: () => void;
  onEdit: () => void;
}) {
  const name = view.service.name;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the checkbox inside takes the keys
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole row ticks its checkbox
    <div
      data-highlight-item=''
      onClick={onPick}
      className='group/service flex cursor-pointer items-center gap-1 rounded-control pe-1'
    >
      <span className={cn(LIST_ROW, LIST_ROW_LINES, 'min-w-0 flex-1 ps-1.5')}>
        <span className={ICON_SLOT}>
          <Checkbox
            size='sm'
            variant='outline'
            checked={picked}
            aria-label={`Select ${name}`}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={onPick}
          />
        </span>
        <ServiceLines view={view} now={now} />
      </span>
      <ServiceActionButton
        label={`Edit ${name}`}
        icon='IconPencil'
        variant='bare'
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      />
    </div>
  );
}
