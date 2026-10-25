import { listWaitsOn, type ShinsaState, type Task } from '@shinsa/core';
import { DropdownMenuContent } from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import * as React from 'react';
import { LazyMenu, LazyMenuTrigger } from '@/components/controls/lazy-menu.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { WaitsOnItems } from '@/components/task/dependency-items.tsx';
import { navigate, resolveTaskPath } from '@/router.ts';

function WaitsOnHint({ waitsOn }: { waitsOn: Task[] }) {
  return (
    <span className='flex flex-col'>
      <TooltipLabel>Waits on</TooltipLabel>
      {waitsOn.map((parent) => (
        <span key={parent.id}>
          {parent.title}
          {parent.stage === 'cancelled' && <TooltipLabel> was cancelled</TooltipLabel>}
        </span>
      ))}
    </span>
  );
}

export function WaitsOnLinks({ waitsOn }: { waitsOn: Task[] }) {
  const cancelled = waitsOn.find((parent) => parent.stage === 'cancelled');
  const shown = cancelled ? [cancelled] : waitsOn;
  return (
    <Hint label={<WaitsOnHint waitsOn={waitsOn} />}>
      <span className='flex w-fit min-w-0 items-center whitespace-pre text-fg-2 text-xs max-md:hidden'>
        {!cancelled && <span className='shrink-0'>Waits on </span>}
        {shown.map((parent, index) => (
          <React.Fragment key={parent.id}>
            {index > 0 && <span className='shrink-0'>, </span>}
            <a
              href={resolveTaskPath(parent)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                navigate(resolveTaskPath(parent));
              }}
              className='min-w-0 truncate text-fg-3 underline-offset-2 hover:text-fg-4 hover:underline active:text-fg-4 active:underline'
            >
              {parent.title}
            </a>
          </React.Fragment>
        ))}
        {cancelled && <span className='shrink-0'> was cancelled</span>}
      </span>
    </Hint>
  );
}

export function ChainArrow({ state, task }: { state: ShinsaState; task: Task }) {
  const waitsOn = listWaitsOn(state, task);
  return (
    <LazyMenu
      kind='dropdown'
      content={
        <DropdownMenuContent align='start' className='min-w-56 max-w-80'>
          <WaitsOnItems state={state} task={task} waitsOn={waitsOn} />
        </DropdownMenuContent>
      }
    >
      <Hint label={<WaitsOnHint waitsOn={waitsOn} />}>
        <LazyMenuTrigger
          render={
            <button
              type='button'
              aria-label='Waits on'
              onClick={(event) => event.stopPropagation()}
              className='grid size-5 shrink-0 cursor-pointer place-items-center rounded-control-sm text-fg-2 hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4 data-popup-open:bg-bg-a2 data-popup-open:text-fg-4'
            />
          }
        >
          <Icon size='sm' name='IconArrowCornerDownRight' />
        </LazyMenuTrigger>
      </Hint>
    </LazyMenu>
  );
}
