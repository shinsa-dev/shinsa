import { isServiceActive, type Project, type ServiceView } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import type { IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { LIST_ROW, LIST_ROW_LINES, LIST_ROW_META, LIST_ROW_TITLE } from '@/components/layout/list-row.tsx';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { useDisclosure } from '@/lib/preferences/disclosure.ts';
import { PREVIEW_SHARE_TITLE, PREVIEW_SHARED_TITLE } from '@/lib/share/previews.ts';
import {
  describeServicePreview,
  describeServiceTerminal,
  describeServiceState,
  resolveServiceLink,
  resolveServiceRowId,
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
  share?: (view: ServiceView) => void;
  canShare?: (view: ServiceView) => boolean;
  sharing?: (view: ServiceView) => boolean;
}

const REVEAL = 'opacity-0 group-hover/disclosure:opacity-100';

const RUN_REVEAL = 'opacity-0 group-data-hovered/service:opacity-100';

const TREE_LINE = 'pointer-events-none absolute start-4 w-px bg-bg-a4';

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

function ServicePreviewButton({
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
  const link = resolveServiceLink(view);
  if (!link) return null;
  return (
    <ServiceActionButton
      label={describeServicePreview(view, label)}
      detail={link.text}
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

const ROW = cn(LIST_ROW, 'h-7 min-w-0 flex-1 items-center ps-1.5 pe-1');

const CHEVRON_SLOT = 'size-3.5 shrink-0';

function ServiceRowTitle({ view, now }: { view: ServiceView; now: number }) {
  const glyph = SERVICE_GLYPHS[view.state];
  const state = describeServiceState(view, now);
  return (
    <>
      <span className={ICON_SLOT}>
        <StatusTile icon={glyph.icon} tone={glyph.tone} size='sm' label={state} />
      </span>
      <Truncate className={cn(LIST_ROW_TITLE, 'min-w-0 shrink')}>{view.service.name}</Truncate>
      <span
        className={cn('shrink-0 text-2xs', glyph.tone === 'neutral' ? 'text-fg-2' : TONE_TEXT[glyph.tone])}
      >
        {state}
      </span>
    </>
  );
}

function ServiceRowActions({
  view,
  project,
  handlers,
}: {
  view: ServiceView;
  project: Project | null;
  handlers: ServiceHandlers;
}) {
  const name = view.service.name;
  const active = isServiceActive(view);
  return (
    <span className='ms-auto flex shrink-0 items-center gap-px'>
      {project && active && (
        <span className={cn('flex items-center gap-px', RUN_REVEAL)}>
          <ServiceActionButton
            label={`Restart ${name}`}
            icon='IconArrowRotateClockwise'
            size='icon-xs'
            onClick={() => handlers.restart(view)}
          />
          <ServiceActionButton
            label={`Stop ${name}`}
            icon='IconStop'
            size='icon-xs'
            onClick={() => handlers.stop(view)}
          />
        </span>
      )}
      <ServiceShareButton view={view} handlers={handlers} size='icon-xs' reveal />
      {view.terminal && project && (
        <ServiceActionButton
          label={describeServiceTerminal(view)}
          icon='IconConsole'
          size='icon-xs'
          onClick={() => handlers.open(view, project)}
        />
      )}
      {project && !active ? (
        <ServiceActionButton
          label={`Start ${name}`}
          icon='IconPlay'
          size='icon-xs'
          onClick={() => handlers.start(view)}
        />
      ) : resolveServiceLink(view) ? (
        <ServicePreviewButton view={view} size='icon-xs' onPreview={() => handlers.preview(view)} />
      ) : (
        <span aria-hidden className='size-5.5 shrink-0' />
      )}
    </span>
  );
}

export function ServiceRow({
  view,
  project,
  now,
  handlers,
  runs = [],
}: {
  view: ServiceView;
  project: Project | null;
  now: number;
  handlers: ServiceHandlers;
  runs?: TaskServiceRun[];
}) {
  const disclosure = useDisclosure(resolveServiceRowId(view.service.id), false);
  const expandable = project !== null && runs.length > 0;
  const open = expandable && disclosure.open;
  const actions = <ServiceRowActions view={view} project={project} handlers={handlers} />;
  return (
    <div data-service-row='' data-folded={open ? undefined : ''} className='relative flex flex-col'>
      {open && <span aria-hidden className={cn(TREE_LINE, 'top-7 bottom-0')} />}
      <div data-highlight-item='' className='group/service flex rounded-control'>
        {expandable ? (
          <DisclosureHeader
            disclosure={disclosure}
            label={view.service.name}
            action={actions}
            chevron='glyph'
            chevronClassName={REVEAL}
            className={ROW}
          >
            <ServiceRowTitle view={view} now={now} />
          </DisclosureHeader>
        ) : (
          <div className={cn(ROW, 'cursor-default')}>
            <ServiceRowTitle view={view} now={now} />
            {actions}
            <span aria-hidden className={CHEVRON_SLOT} />
          </div>
        )}
      </div>
      {open &&
        project &&
        runs.map((run, index) => (
          <TaskRunRow
            key={run.view.terminal?.id ?? run.view.taskId}
            run={run}
            last={index === runs.length - 1}
            project={project}
            now={now}
            handlers={handlers}
          />
        ))}
    </div>
  );
}

function ServiceShareButton({
  view,
  handlers,
  size = 'icon-sm',
  reveal = false,
}: {
  view: ServiceView;
  handlers: ServiceHandlers;
  size?: 'icon-xs' | 'icon-sm';
  reveal?: boolean;
}) {
  const share = handlers.share;
  if (!(share && view.taskId && selectServicePreview(view))) return null;
  if (handlers.canShare && !handlers.canShare(view)) return null;
  const shared = handlers.sharing?.(view) ?? false;
  return (
    <span className={cn('flex items-center', reveal && !shared && RUN_REVEAL)}>
      <ServiceActionButton
        label={shared ? PREVIEW_SHARED_TITLE : PREVIEW_SHARE_TITLE}
        icon={shared ? 'IconLiveFull' : 'IconShareOs'}
        size={size}
        onClick={(event) => {
          event.stopPropagation();
          share(view);
        }}
      />
    </span>
  );
}

function RunButtons({
  view,
  label,
  handlers,
}: {
  view: ServiceView;
  label: string;
  handlers: ServiceHandlers;
}) {
  const name = view.service.name;
  if (!isServiceActive(view))
    return (
      <ServiceActionButton
        label={`Start ${name}`}
        icon='IconPlay'
        size='icon-xs'
        onClick={() => handlers.start(view)}
      />
    );
  return (
    <span className='flex shrink-0 items-center gap-px'>
      <span className={cn('flex items-center gap-px', RUN_REVEAL)}>
        <ServiceActionButton
          label={`Restart ${name}`}
          icon='IconArrowRotateClockwise'
          size='icon-xs'
          onClick={() => handlers.restart(view)}
        />
        <ServiceActionButton
          label={`Stop ${name}`}
          icon='IconStop'
          size='icon-xs'
          onClick={() => handlers.stop(view)}
        />
      </span>
      <ServiceShareButton view={view} handlers={handlers} size='icon-xs' reveal />
      <ServicePreviewButton
        view={view}
        label={label}
        size='icon-xs'
        onPreview={() => handlers.preview(view)}
      />
    </span>
  );
}

function TaskRunRow({
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
      className='group/service relative flex items-center gap-2 rounded-control ps-6 pe-1'
    >
      <span aria-hidden className={cn(TREE_LINE, 'top-0', last ? 'h-1/2' : 'bottom-0')} />
      <span aria-hidden className='pointer-events-none absolute start-4 top-1/2 h-px w-2.5 bg-bg-a4' />
      <button
        type='button'
        aria-label={`Open the terminal of ${view.service.name} for ${label}`}
        onClick={() => handlers.open(view, project)}
        className={cn(LIST_ROW, 'h-7 min-w-0 flex-1 items-center ps-1.5')}
      >
        <StatusTile icon={glyph.icon} tone={glyph.tone} size='sm' label={state} />
        <Truncate className='min-w-0 flex-1 text-xs text-fg-3'>{label}</Truncate>
        <span
          className={cn('shrink-0 text-2xs', glyph.tone === 'neutral' ? 'text-fg-2' : TONE_TEXT[glyph.tone])}
        >
          {state}
        </span>
      </button>
      <RunButtons view={view} label={label} handlers={handlers} />
      <span aria-hidden className={CHEVRON_SLOT} />
    </div>
  );
}

function ServiceLines({ view, now }: { view: ServiceView; now: number }) {
  const glyph = SERVICE_GLYPHS[view.state];
  return (
    <span className='flex min-w-0 flex-1 flex-col'>
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
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the checkbox inside takes the keys; the whole row ticks its checkbox
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
