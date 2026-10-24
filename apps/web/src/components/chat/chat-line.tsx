import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ImageStrip } from '@/components/chat/image-strip.tsx';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import type { ViewerImage } from '@/hooks/use-image-viewer.ts';

export const ROW_INDENT = 'ps-6.25';

export const SHIMMER_LINE = 'block truncate leading-normal';

export const SELECTED_WASH =
  'outline-2 outline-transparent transition-colors duration-500 data-focused:bg-primary-a1 data-focused:outline-primary-a1';

const LINE = 'flex h-5 min-w-0 max-w-full items-center gap-px self-start text-left text-xs';

const LINE_BUTTON = `group/row ${LINE} cursor-pointer`;

const LINE_INK =
  'text-fg-3 transition-colors duration-150 group-hover/row:text-fg-4 group-active/row:text-fg-4';

const LINE_LABEL = `min-w-0 truncate font-medium ${LINE_INK}`;

const LINE_META = 'flex min-w-0 shrink whitespace-pre text-fg-2';

export const CARD_LINE = 'flex h-9 min-w-0 shrink-0 items-center gap-1.25 bg-bg-a1 px-3 text-xs';

export function CardLine({ icon, title, meta }: { icon: IconName; title: string; meta?: React.ReactNode }) {
  return (
    <h3 data-chat-line className={CARD_LINE}>
      <IconSlot>
        <Icon name={icon} size='sm' className='text-fg-4' />
      </IconSlot>
      <span className='min-w-0 truncate font-medium text-fg-4'>{title}</span>
      {meta && <span className='ms-auto shrink-0 ps-3 text-fg-2'>{meta}</span>}
    </h3>
  );
}

export function RowChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <Icon
      name='IconChevronRightSmall'
      size='sm'
      className={cn(
        'text-fg-3 transition-[rotate,opacity,color] duration-200 group-hover/row:text-fg-4 group-active/row:text-fg-4',
        open && 'rotate-90',
        className
      )}
    />
  );
}

export function DetailRail({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 gap-1.25 pt-3 pb-1', className)}>
      <span aria-hidden className='flex w-5 shrink-0 justify-center'>
        <span className='w-px bg-border' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-2.5'>{children}</div>
    </div>
  );
}

interface LineParts {
  icon: IconName | React.ReactElement;
  iconClassName?: string;
  label: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
}

function LineBody({ icon, iconClassName, label, meta, trailing }: LineParts) {
  return (
    <>
      <IconSlot className='me-1'>
        {typeof icon === 'string' ? (
          <Icon name={icon} size='sm' className={iconClassName ?? LINE_INK} />
        ) : (
          icon
        )}
      </IconSlot>
      <span className={LINE_LABEL}>{label}</span>
      {meta && (
        <span className={LINE_META}>
          {React.isValidElement(meta) ? (
            <>
              <span className='shrink-0'>{' · '}</span>
              {meta}
            </>
          ) : (
            <span className='min-w-0 truncate whitespace-pre text-fg-2'>
              {' · '}
              {meta}
            </span>
          )}
        </span>
      )}
      {trailing && <span className='ms-1.5 flex shrink-0 items-center'>{trailing}</span>}
    </>
  );
}

export function ChatLine({ className, ...parts }: LineParts & { className?: string }) {
  return (
    <div data-chat-line className={cn(LINE, className)}>
      <LineBody {...parts} />
    </div>
  );
}

export function FoldLine({
  open,
  onToggle,
  label,
  meta,
  trailing,
  disabled = false,
}: {
  open: boolean;
  onToggle: () => void;
  label: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type='button'
      data-chat-line
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
      className={cn(LINE_BUTTON, 'disabled:cursor-default')}
    >
      <LineBody icon={<RowChevron open={open} />} label={label} meta={meta} trailing={trailing} />
    </button>
  );
}

export function ExpandRow({
  children,
  images = [],
  ...parts
}: LineParts & {
  children: React.ReactNode;
  images?: (string | ViewerImage)[];
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className='flex min-w-0 flex-col'>
      <button
        type='button'
        data-chat-line
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={LINE_BUTTON}
      >
        <LineBody {...parts} />
        <RowChevron open={open} className={open ? undefined : 'opacity-0 group-hover/row:opacity-100'} />
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
