import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import {
  type DisclosureChevron as ChevronKind,
  type DisclosureStrip,
  resolveDisclosureStrip,
  TRAILING_BOX,
} from '@/components/layout/surface/disclosure.ts';
import type { Disclosure } from '@/lib/preferences/disclosure.ts';

type HeaderTag = 'div' | 'h2' | 'h3' | 'figcaption';

interface DisclosureTrigger {
  open: boolean;
  label: string | undefined;
  separate: boolean;
}

const TriggerContext = React.createContext<DisclosureTrigger | null>(null);

const GLYPH_CHEVRON =
  'corner-superellipse/1.125 grid size-3.5 shrink-0 place-items-center rounded-control-sm outline-none group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4';

function describeToggle(open: boolean, label: string) {
  return `${open ? 'Collapse' : 'Expand'} ${label}`;
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <Icon
      name='IconChevronDownSmall'
      className={cn('transition-[rotate] duration-150', !open && '-rotate-90')}
    />
  );
}

function BoxChevron({ trigger, className }: { trigger: DisclosureTrigger | null; className?: string }) {
  const open = trigger?.open ?? false;
  const classes = cn(TRAILING_BOX, className);
  if (!trigger?.separate) {
    return (
      <Button
        variant='secondary'
        size='icon-xs'
        nativeButton={false}
        render={<span />}
        tabIndex={-1}
        aria-hidden
        data-disclosure-chevron
        className={classes}
      >
        <ChevronGlyph open={open} />
      </Button>
    );
  }
  return (
    <Button
      variant='secondary'
      size='icon-xs'
      data-disclosure-chevron
      aria-expanded={open}
      aria-label={trigger.label ? describeToggle(open, trigger.label) : undefined}
      className={classes}
    >
      <ChevronGlyph open={open} />
    </Button>
  );
}

export function DisclosureChevron({ kind = 'glyph', className }: { kind?: ChevronKind; className?: string }) {
  const trigger = React.useContext(TriggerContext);
  if (kind === 'box') return <BoxChevron trigger={trigger} className={className} />;
  const open = trigger?.open ?? false;
  const glyph = <ChevronGlyph open={open} />;
  const classes = cn(GLYPH_CHEVRON, className);
  if (!trigger?.separate) {
    return (
      <span data-disclosure-chevron aria-hidden className={classes}>
        {glyph}
      </span>
    );
  }
  return (
    <button
      type='button'
      data-disclosure-chevron
      aria-expanded={open}
      aria-label={trigger.label ? describeToggle(open, trigger.label) : undefined}
      className={cn(classes, 'cursor-pointer')}
    >
      {glyph}
    </button>
  );
}

export function DisclosureAction({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps a header action's click from folding the header
    // biome-ignore lint/a11y/useKeyWithClickEvents: only stops a click from reaching the header
    <span
      data-disclosure-action
      className={cn('flex min-w-0 items-center', className)}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}

export function DisclosureHeader({
  as: Tag = 'div',
  disclosure,
  label,
  strip,
  chevron,
  chevronClassName,
  action,
  interactive = false,
  className,
  children,
}: {
  as?: HeaderTag;
  disclosure: Disclosure;
  label?: string;
  strip?: DisclosureStrip;
  chevron?: ChevronKind;
  chevronClassName?: string;
  action?: React.ReactNode;
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { open, toggle: onToggle } = disclosure;
  const separate = interactive || Boolean(action);
  const trigger = React.useMemo(() => ({ open, label, separate }), [open, label, separate]);
  const header = cn(
    'group/disclosure flex min-w-0 cursor-pointer select-none items-center text-left',
    className,
    strip && chevron && resolveDisclosureStrip(strip, chevron)
  );
  const content = (
    <TriggerContext.Provider value={trigger}>
      {children}
      {action && <DisclosureAction className='ms-auto shrink-0'>{action}</DisclosureAction>}
      {chevron && <DisclosureChevron kind={chevron} className={cn(!action && 'ms-auto', chevronClassName)} />}
    </TriggerContext.Provider>
  );
  if (separate) {
    return (
      <Tag data-disclosure-header={strip ?? ''} className={header} onClick={onToggle}>
        {content}
      </Tag>
    );
  }
  const button = (
    <button
      type='button'
      data-disclosure-header={strip ?? ''}
      aria-expanded={open}
      aria-label={label ? describeToggle(open, label) : undefined}
      onClick={onToggle}
      className={cn(header, 'outline-none', Tag !== 'div' && 'w-full')}
    >
      {content}
    </button>
  );
  if (Tag === 'div') return button;
  return <Tag className='flex min-w-0'>{button}</Tag>;
}
