import { isServiceActive, type Project, type ServiceView } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import type { IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { describeServiceState, SERVICE_GLYPHS } from '@/lib/terminal/services.ts';

export interface ServiceHandlers {
  start: (view: ServiceView) => void;
  stop: (view: ServiceView) => void;
  restart: (view: ServiceView) => void;
  open: (view: ServiceView, project: Project) => void;
  edit: (view: ServiceView, project: Project) => void;
  remove: (view: ServiceView) => void;
}

function ServiceGlyph({ view, now }: { view: ServiceView; now: number }) {
  return <StatusTile {...SERVICE_GLYPHS[view.state]} label={describeServiceState(view, now)} />;
}

function ActionButton({
  label,
  icon,
  size = 'icon-sm',
  onClick,
}: {
  label: string;
  icon: IconName;
  size?: 'icon-xs' | 'icon-sm';
  onClick: () => void;
}) {
  return (
    <Hint label={label}>
      <Button variant='secondary' size={size} icon={icon} aria-label={label} onClick={onClick} />
    </Hint>
  );
}

export function ServiceRunButtons({
  view,
  size = 'icon-sm',
  onStart,
  onStop,
  onRestart,
}: {
  view: ServiceView;
  size?: 'icon-xs' | 'icon-sm';
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const name = view.service.name;
  if (!isServiceActive(view))
    return <ActionButton label={`Start ${name}`} icon='IconPlay' size={size} onClick={onStart} />;
  return (
    <>
      <ActionButton
        label={`Restart ${name}`}
        icon='IconArrowRotateClockwise'
        size={size}
        onClick={onRestart}
      />
      <ActionButton label={`Stop ${name}`} icon='IconStop' size={size} onClick={onStop} />
    </>
  );
}

export function ServiceRow({
  view,
  project,
  now,
  handlers,
}: {
  view: ServiceView;
  project: Project;
  now: number;
  handlers: ServiceHandlers;
}) {
  const { terminal } = view;
  const glyph = SERVICE_GLYPHS[view.state];
  return (
    <div data-highlight-item='' className='flex items-center gap-2 rounded-control py-1 ps-1.5 pe-1'>
      <ServiceGlyph view={view} now={now} />
      <button
        type='button'
        disabled={!terminal}
        onClick={() => handlers.open(view, project)}
        className='flex min-w-0 flex-1 cursor-pointer flex-col gap-px text-left outline-none disabled:cursor-default'
      >
        <Truncate className='text-fg-4 text-xs'>{view.service.name}</Truncate>
        <Truncate className='text-2xs text-fg-2'>
          <span className={cn(glyph.tone !== 'neutral' && TONE_TEXT[glyph.tone])}>
            {describeServiceState(view, now)}
          </span>{' '}
          · {view.service.command}
        </Truncate>
      </button>
      <span className='flex shrink-0 items-center'>
        <ServiceRunButtons
          view={view}
          onStart={() => handlers.start(view)}
          onStop={() => handlers.stop(view)}
          onRestart={() => handlers.restart(view)}
        />
        {terminal && (
          <ActionButton
            label='Open terminal'
            icon='IconConsole'
            onClick={() => handlers.open(view, project)}
          />
        )}
        <DropdownMenu>
          <OptionsTrigger label={`More for ${view.service.name}`} />
          <DropdownMenuContent align='end' className='min-w-44'>
            <DropdownMenuItem onClick={() => handlers.edit(view, project)}>Edit…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant='destructive' onClick={() => handlers.remove(view)}>
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}
