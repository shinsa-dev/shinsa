import { listWaitsOn, type ShinsaState, selectStackParent, type Task } from '@shinsa/core';
import { DropdownMenuContent } from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { LazyMenu, LazyMenuTrigger } from '@/components/controls/lazy-menu.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { WaitsOnItems } from '@/components/task/dependency-items.tsx';
import { BUNDLE_ICON } from '@/lib/tasks/bundles.ts';
import { navigate, resolveTaskPath, withRouteBase } from '@/router.ts';

const WAITS_ON = 'Waits on';

const STACKED_ON = 'Stacked on';

const STACKED_DETAIL = 'Merges with its bundle';

function WaitsOnHint({
  waitsOn,
  label = WAITS_ON,
  detail,
}: {
  waitsOn: Task[];
  label?: string;
  detail?: string;
}) {
  return (
    <span className='flex max-w-72 flex-col gap-px'>
      <TooltipLabel>{label}</TooltipLabel>
      {waitsOn.map((parent) => (
        <span key={parent.id} className='flex min-w-0 gap-1.5'>
          {parent.handle && <span className='shrink-0 text-fg-2 tabular-nums'>{parent.handle}</span>}
          <span className='min-w-0'>
            {parent.title}
            {parent.stage === 'cancelled' && <TooltipLabel> was cancelled</TooltipLabel>}
          </span>
        </span>
      ))}
      {detail && <TooltipLabel>{detail}</TooltipLabel>}
    </span>
  );
}

function openTask(event: React.MouseEvent, task: Task) {
  event.preventDefault();
  event.stopPropagation();
  navigate(resolveTaskPath(task));
}

function ParentLink({ parent }: { parent: Task }) {
  return (
    <a
      href={withRouteBase(resolveTaskPath(parent))}
      aria-label={parent.title}
      onClick={(event) => openTask(event, parent)}
      className={cn(
        'min-w-0 truncate text-fg-3 underline-offset-2 hover:text-fg-4 hover:underline active:text-fg-4 active:underline',
        parent.handle && 'shrink-0 tabular-nums'
      )}
    >
      {parent.handle ?? parent.title}
    </a>
  );
}

export function WaitsOnLinks({ waitsOn, stacked = false }: { waitsOn: Task[]; stacked?: boolean }) {
  const cancelled = waitsOn.find((parent) => parent.stage === 'cancelled');
  const [first, ...rest] = cancelled ? [cancelled] : waitsOn;
  if (!first) return null;
  const label = stacked ? STACKED_ON : WAITS_ON;
  return (
    <Hint
      label={<WaitsOnHint waitsOn={waitsOn} label={label} detail={stacked ? STACKED_DETAIL : undefined} />}
    >
      <span className='flex w-fit min-w-0 items-center text-xs whitespace-pre text-fg-2 max-md:hidden'>
        {!cancelled && <span className='shrink-0'>{label} </span>}
        <ParentLink parent={first} />
        {rest.length > 0 && <span className='shrink-0 tabular-nums'> +{rest.length}</span>}
        {cancelled && <span className='shrink-0'> was cancelled</span>}
      </span>
    </Hint>
  );
}

const CHAIN_MARK =
  'grid size-5 shrink-0 cursor-pointer place-items-center rounded-control-sm text-fg-2 hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4 data-popup-open:bg-bg-a2 data-popup-open:text-fg-4';

function StackMark({ parent }: { parent: Task }) {
  return (
    <Hint label={<WaitsOnHint waitsOn={[parent]} label={STACKED_ON} detail={STACKED_DETAIL} />}>
      <a
        href={withRouteBase(resolveTaskPath(parent))}
        aria-label={`${STACKED_ON} ${parent.handle ?? parent.title}`}
        onClick={(event) => openTask(event, parent)}
        className={CHAIN_MARK}
      >
        <Icon size='sm' name={BUNDLE_ICON} />
      </a>
    </Hint>
  );
}

export function ChainArrow({ state, task }: { state: ShinsaState; task: Task }) {
  const parent = selectStackParent(state, task);
  if (parent) return <StackMark parent={parent} />;
  const waitsOn = listWaitsOn(state, task);
  return (
    <LazyMenu
      kind='dropdown'
      content={
        <DropdownMenuContent align='start' className='max-w-80 min-w-56'>
          <WaitsOnItems state={state} task={task} waitsOn={waitsOn} />
        </DropdownMenuContent>
      }
    >
      <Hint label={<WaitsOnHint waitsOn={waitsOn} />}>
        <LazyMenuTrigger
          render={
            <button
              type='button'
              aria-label={WAITS_ON}
              onClick={(event) => event.stopPropagation()}
              className={CHAIN_MARK}
            />
          }
        >
          <Icon size='sm' name='IconArrowCornerDownRight' />
        </LazyMenuTrigger>
      </Hint>
    </LazyMenu>
  );
}
