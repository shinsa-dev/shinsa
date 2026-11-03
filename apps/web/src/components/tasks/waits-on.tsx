import { listWaitsOn, type ShinsaState, type Task } from '@shinsa/core';
import { DropdownMenuContent } from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import { LazyMenu, LazyMenuTrigger } from '@/components/controls/lazy-menu.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { WaitsOnItems } from '@/components/task/dependency-items.tsx';
import { navigate, resolveTaskPath, withRouteBase } from '@/router.ts';

function WaitsOnHint({ waitsOn }: { waitsOn: Task[] }) {
  return (
    <span className='flex max-w-72 flex-col gap-px'>
      <TooltipLabel>Waits on</TooltipLabel>
      {waitsOn.map((parent) => (
        <span key={parent.id} className='flex min-w-0 gap-1.5'>
          {parent.handle && <span className='shrink-0 text-fg-2 tabular-nums'>{parent.handle}</span>}
          <span className='min-w-0'>
            {parent.title}
            {parent.stage === 'cancelled' && <TooltipLabel> was cancelled</TooltipLabel>}
          </span>
        </span>
      ))}
    </span>
  );
}

function ParentLink({ parent }: { parent: Task }) {
  return (
    <a
      href={withRouteBase(resolveTaskPath(parent))}
      aria-label={parent.title}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigate(resolveTaskPath(parent));
      }}
      className={cn(
        'min-w-0 truncate text-fg-3 underline-offset-2 hover:text-fg-4 hover:underline active:text-fg-4 active:underline',
        parent.handle && 'shrink-0 tabular-nums'
      )}
    >
      {parent.handle ?? parent.title}
    </a>
  );
}

export function WaitsOnLinks({ waitsOn }: { waitsOn: Task[] }) {
  const cancelled = waitsOn.find((parent) => parent.stage === 'cancelled');
  const [first, ...rest] = cancelled ? [cancelled] : waitsOn;
  if (!first) return null;
  return (
    <Hint label={<WaitsOnHint waitsOn={waitsOn} />}>
      <span className='flex w-fit min-w-0 items-center text-xs whitespace-pre text-fg-2 max-md:hidden'>
        {!cancelled && <span className='shrink-0'>Waits on </span>}
        <ParentLink parent={first} />
        {rest.length > 0 && <span className='shrink-0 tabular-nums'> +{rest.length}</span>}
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
