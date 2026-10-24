import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from '@shinsa/ui/components/preview-card';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

export function InfoPopover({
  render,
  trigger,
  children,
  className,
}: {
  render: React.ReactElement<Record<string, unknown>>;
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <PreviewCard>
      <PreviewCardTrigger render={render}>{trigger}</PreviewCardTrigger>
      <PreviewCardContent className={className}>{children}</PreviewCardContent>
    </PreviewCard>
  );
}

const INFO_ACTION =
  'flex h-8 w-full cursor-pointer items-center gap-1.5 border-border border-t px-3 text-left text-primary-text text-xs no-underline outline-none transition-opacity duration-150 hover:opacity-80 active:opacity-80';

export function InfoAction(props: { label: string } & ({ href: string } | { onClick: () => void })) {
  if ('href' in props) {
    return (
      <a href={props.href} target='_blank' rel='noreferrer' className={INFO_ACTION}>
        {props.label}
        <Icon name='IconArrowUpRight' className='size-3.5' />
      </a>
    );
  }
  return (
    <button type='button' onClick={props.onClick} className={INFO_ACTION}>
      {props.label}
    </button>
  );
}

export function InfoHeader({
  title,
  description,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div className='flex flex-col gap-px px-3 py-2.5'>
      <div className='min-w-0 font-medium text-fg-4 text-xs'>{title}</div>
      {description && <div className='min-w-0 text-2xs text-fg-2'>{description}</div>}
    </div>
  );
}

export function InfoSection({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className='flex flex-col border-border border-t py-1 first:border-t-0'>
      {title && (
        <h3 className='flex h-7 items-center gap-1.5 px-3 font-medium text-2xs text-fg-2'>{title}</h3>
      )}
      {children}
    </section>
  );
}

export function InfoRow({
  icon,
  iconClassName,
  label,
  value,
  valueClassName,
}: {
  icon?: IconName;
  iconClassName?: string;
  label: React.ReactNode;
  value?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className='flex min-h-7 items-center justify-between gap-4 px-3 text-xs'>
      <span className='flex min-w-0 items-center gap-2 text-fg-3'>
        {icon && <Icon name={icon} className={cn('size-3.5 shrink-0', iconClassName)} />}
        <span className='min-w-0 truncate'>{label}</span>
      </span>
      {value !== undefined && value !== null && (
        <span className={cn('shrink-0 text-fg-2', valueClassName)}>{value}</span>
      )}
    </div>
  );
}

export function InfoLine({ label, value }: { label: React.ReactNode; value?: React.ReactNode }) {
  return (
    <span className='flex items-center justify-between gap-4'>
      <span className='min-w-0'>{label}</span>
      {value ? <span className='flex shrink-0 items-center'>{value}</span> : null}
    </span>
  );
}
