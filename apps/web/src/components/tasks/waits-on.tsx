import { listStackParents, listWaitsOn, type ShinsaState, type Task } from '@shinsa/core';
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

function StackMark({ parents }: { parents: Task[] }) {
  const [first, ...rest] = parents;
  if (!first) return null;
  const name = first.handle ?? first.title;
  return (
    <Hint label={<WaitsOnHint waitsOn={parents} label={STACKED_ON} detail={STACKED_DETAIL} />}>
      <a
        href={withRouteBase(resolveTaskPath(first))}
        aria-label={
          rest.length > 0 ? `${STACKED_ON} ${name} and ${rest.length} more` : `${STACKED_ON} ${name}`
        }
        onClick={(event) => openTask(event, first)}
        className={CHAIN_MARK}
      >
        <Icon size='sm' name={BUNDLE_ICON} />
      </a>
    </Hint>
  );
}

function ChainHint({ parents, others }: { parents: Task[]; others: Task[] }) {
  if (parents.length === 0) return <WaitsOnHint waitsOn={others} />;
  return (
    <span className='flex flex-col gap-2'>
      <WaitsOnHint waitsOn={parents} label={STACKED_ON} detail={STACKED_DETAIL} />
      <WaitsOnHint waitsOn={others} />
    </span>
  );
}

export function ChainArrow({ state, task }: { state: ShinsaState; task: Task }) {
  const parents = listStackParents(state, task);
  const stacked = new Set(parents.map((parent) => parent.id));
  const others = listWaitsOn(state, task).filter((waited) => !stacked.has(waited.id));
  const [first] = parents;
  if (first && others.length === 0) return <StackMark parents={parents} />;
  return (
    <LazyMenu
      kind='dropdown'
      content={
        <DropdownMenuContent align='start' className='max-w-80 min-w-56'>
          <WaitsOnItems state={state} task={task} waitsOn={[...parents, ...others]} />
        </DropdownMenuContent>
      }
    >
      <Hint label={<ChainHint parents={parents} others={others} />}>
        <LazyMenuTrigger
          render={
            <button
              type='button'
              aria-label={
                first
                  ? `${STACKED_ON} ${first.handle ?? first.title}, ${WAITS_ON.toLowerCase()} ${others.length} more`
                  : WAITS_ON
              }
              onClick={(event) => event.stopPropagation()}
              className={CHAIN_MARK}
            />
          }
        >
          <Icon size='sm' name={first ? BUNDLE_ICON : 'IconArrowCornerDownRight'} />
        </LazyMenuTrigger>
      </Hint>
    </LazyMenu>
  );
}
