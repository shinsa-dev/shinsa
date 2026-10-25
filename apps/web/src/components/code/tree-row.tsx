import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

const INDENT = 8;

const EDGE = 4;

const GUIDE = 7;

export const TREE_LIST = 'flex flex-col px-1 py-1';

export const TREE_ROW_HEIGHT = 22;

export const TREE_HOVER_GROUP = 'group/tree';

const HOVER_INTENT_MS = 40;

function useHoverIntent(onPrefetch: (() => void) | undefined) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return {
    onPointerEnter: () => {
      if (!onPrefetch || timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        onPrefetch();
      }, HOVER_INTENT_MS);
    },
    onPointerLeave: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
  };
}

export function TreeRow({
  depth,
  guide,
  selected = false,
  expanded,
  icon,
  children,
  end,
  label,
  className,
  onOpen,
  onPrefetch,
}: {
  depth: number;
  guide?: number;
  selected?: boolean;
  expanded?: boolean;
  icon?: IconName;
  children: React.ReactNode;
  end?: React.ReactNode;
  label?: string;
  className?: string;
  onOpen: () => void;
  onPrefetch?: () => void;
}) {
  const pressed = React.useRef(false);
  const hover = useHoverIntent(onPrefetch);
  return (
    <div
      role='treeitem'
      aria-selected={selected}
      aria-expanded={expanded}
      aria-label={label}
      tabIndex={-1}
      onPointerDown={(event) => {
        pressed.current =
          event.pointerType === 'mouse' &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey;
        if (!pressed.current) return;
        hover.onPointerLeave();
        onOpen();
      }}
      onClick={() => {
        if (pressed.current) {
          pressed.current = false;
          return;
        }
        onOpen();
      }}
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
      onFocus={onPrefetch}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      style={{ paddingInlineStart: EDGE + depth * INDENT }}
      className={cn(
        'corner-superellipse/1.125 relative flex h-5.5 w-full shrink-0 cursor-pointer select-none items-center gap-1 rounded-control-sm pe-1.5 text-2xs outline-none',
        selected ? 'bg-primary-a1 text-fg-4' : 'text-fg-3 hover:bg-bg-a2 active:bg-bg-a2',
        className
      )}
    >
      {Array.from({ length: depth }, (_, level) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: one guide per level, never reordered
          key={level}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 w-px opacity-0 group-hover/tree:opacity-100',
            level === guide ? 'bg-fg-1' : 'bg-bg-a4'
          )}
          style={{ insetInlineStart: EDGE + level * INDENT + GUIDE - 1 }}
        />
      ))}
      <span className='flex w-3.5 shrink-0 items-center justify-center'>
        {expanded !== undefined && (
          <Icon name='IconChevronDownSmall' size='sm' className={cn(!expanded && '-rotate-90')} />
        )}
      </span>
      {icon && <Icon name={icon} size='sm' />}
      <span className='ms-0.5 flex min-w-0 flex-1 items-center gap-1.5'>{children}</span>
      {end}
    </div>
  );
}
