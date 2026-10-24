import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { ShimmeringText } from '@shinsa/ui/components/shimmering-text';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ImageStrip } from '@/components/chat/image-strip.tsx';
import { ToolDetail } from '@/components/chat/tool-detail.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { useCallImages } from '@/hooks/use-call-images.ts';
import type { ViewerImage } from '@/hooks/use-image-viewer.ts';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { resolveGroupKey, resolveGroupPhrase, resolveRunningLabel } from '@/lib/chat/tool-describe.ts';
import { resolveEditStats } from '@/lib/chat/tool-output.ts';

const COLLAPSE_AFTER = 5;

export const ROW_INDENT = 'ps-5.25';

const ROW_BUTTON =
  'group/row flex h-5 min-w-0 max-w-full cursor-pointer items-center gap-px self-start text-left text-xs';

const ROW_INK =
  'text-fg-3 transition-colors duration-150 group-hover/row:text-fg-4 group-active/row:text-fg-4';

const ROW_LABEL = `min-w-0 truncate font-medium ${ROW_INK}`;

export function RowChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <Icon
      name='IconChevronRightSmall'
      className={cn(
        'size-4 shrink-0 text-fg-3 transition-[rotate,opacity,color] duration-200 group-hover/row:text-fg-4 group-active/row:text-fg-4',
        open && 'rotate-90',
        className
      )}
    />
  );
}

export function IconSlot({ children }: { children: React.ReactNode }) {
  return <span className='grid size-5 shrink-0 place-items-center'>{children}</span>;
}

function DetailRail({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex min-w-0 gap-2 pt-3 pb-1'>
      <span aria-hidden className='flex w-5 shrink-0 justify-center'>
        <span className='w-px bg-border' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-2.5'>{children}</div>
    </div>
  );
}

export function ExpandRow({
  icon,
  iconClassName,
  label,
  trailing,
  children,
  images = [],
}: {
  icon: IconName;
  iconClassName?: string;
  label: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  images?: (string | ViewerImage)[];
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className='flex min-w-0 flex-col'>
      <button type='button' aria-expanded={open} onClick={() => setOpen(!open)} className={ROW_BUTTON}>
        <IconSlot>
          <Icon name={icon} className={cn('size-4', iconClassName ?? ROW_INK)} />
        </IconSlot>
        <span className={ROW_LABEL}>{label}</span>
        {trailing && <span className='ms-1.5 flex shrink-0 items-center'>{trailing}</span>}
        <RowChevron
          open={open}
          className={open ? undefined : 'opacity-0 group-hover/row:opacity-(--icon-alpha)'}
        />
      </button>
      {images.length > 0 && !open && <ImageStrip images={images} className={cn('pt-2.5', ROW_INDENT)} />}
      {open && (
        <DetailRail>
          {children}
          <ImageStrip images={images} size='lg' />
        </DetailRail>
      )}
    </div>
  );
}

function ToolLabel({ call }: { call: ToolCall }) {
  const { verb, target, code, scope } = call.description;
  return (
    <span className='flex min-w-0 items-baseline gap-1.5'>
      <span className='shrink-0'>{verb}</span>
      {target && (
        <Truncate className={cn('font-normal text-fg-4', code && 'font-mono text-2xs')}>{target}</Truncate>
      )}
      {scope && <Truncate className='shrink font-normal text-fg-2'>· {scope}</Truncate>}
    </span>
  );
}

export function ToolRow({ call, live }: { call: ToolCall; live: boolean }) {
  const running = live && call.result === null;
  const images = useCallImages(call);
  const stats = React.useMemo(() => resolveEditStats(call.tool), [call.tool]);
  return (
    <ExpandRow
      icon={call.failed ? 'IconExclamationCircle' : call.description.icon}
      iconClassName={call.failed ? 'text-red-text' : undefined}
      label={
        running ? (
          <ShimmeringText text={resolveRunningLabel(call.description)} className='block truncate' />
        ) : (
          <ToolLabel call={call} />
        )
      }
      trailing={
        call.failed ? (
          <span className='shrink-0 text-2xs text-red-text'>Failed</span>
        ) : (
          stats && <DiffStats {...stats} />
        )
      }
      images={images}
    >
      <ToolDetail call={call} running={running} />
    </ExpandRow>
  );
}

export function ToolGroup({ calls, live }: { calls: ToolCall[]; live: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [single] = calls;
  if (calls.length === 1 && single) return <ToolRow call={single} live={live} />;
  const failures = calls.filter((call) => call.failed).length;
  const current = live ? calls.filter((call) => call.result === null).at(-1) : undefined;
  const label = resolveGroupPhrase(calls.map((call) => resolveGroupKey(call.tool)));
  return (
    <div className='flex min-w-0 flex-col'>
      <button type='button' aria-expanded={open} onClick={() => setOpen(!open)} className={ROW_BUTTON}>
        <IconSlot>
          <RowChevron open={open} />
        </IconSlot>
        <span className={ROW_LABEL}>
          {current ? <ShimmeringText text={label} className='block truncate' /> : label}
        </span>
        {failures > 0 && <span className='ms-1.5 shrink-0 text-2xs text-red-text'>{failures} failed</span>}
      </button>
      {!open && current && (
        <div className={cn('pt-3', ROW_INDENT)}>
          <ToolRow call={current} live={live} />
        </div>
      )}
      {!open && !current && (
        <ImageStrip images={calls.flatMap((call) => call.images)} className={cn('pt-2.5', ROW_INDENT)} />
      )}
      {open && (
        <div className='flex min-w-0 flex-col gap-3 pt-3'>
          {calls.map((call) => (
            <ToolRow key={call.key} call={call} live={live} />
          ))}
          {calls.length > COLLAPSE_AFTER && (
            <button type='button' onClick={() => setOpen(false)} className={ROW_BUTTON}>
              <IconSlot>
                <RowChevron open={false} className='-rotate-90' />
              </IconSlot>
              <span className={ROW_LABEL}>Collapse</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
