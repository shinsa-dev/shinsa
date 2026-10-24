import type { ShinsaState, Task } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CARD, CARD_FOOTER } from '@/components/layout/surface/card.ts';
import { StatusText } from '@/components/status/text.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { resolveRoundTag } from '@/lib/tasks/rounds.ts';

export function NowFrame({
  eyebrow,
  title,
  action,
  children,
  footer,
}: {
  eyebrow: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <div className='flex flex-col gap-3 p-3'>
        <div className='flex items-start gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-px'>
            <span className='text-2xs text-fg-2'>{eyebrow}</span>
            <InlineMarkdown text={title} className='font-medium text-fg-4 text-sm leading-tighter' />
          </div>
          {action && <div className='flex shrink-0 items-center gap-1.5'>{action}</div>}
        </div>
        {children}
      </div>
      {footer && <div className={CARD_FOOTER}>{footer}</div>}
    </section>
  );
}

export function Eyebrow({ state, task, extra }: { state: ShinsaState; task: Task; extra?: React.ReactNode }) {
  const round = resolveRoundTag(task);
  return (
    <span className='flex items-center gap-1.5'>
      <StatusText state={state} task={task} className='text-2xs' />
      {round && (
        <>
          <span>·</span>
          <span className='tabular-nums'>{round}</span>
        </>
      )}
      {extra && (
        <>
          <span>·</span>
          {extra}
        </>
      )}
    </span>
  );
}

export function FooterNote({ note, children }: { note: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center gap-3 text-2xs text-fg-2'>
      <span>{note}</span>
      <span className='flex-1' />
      {children}
    </div>
  );
}

export function QuietLink({
  busy = false,
  onClick,
  children,
}: {
  busy?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      disabled={busy}
      onClick={onClick}
      className='cursor-pointer whitespace-nowrap transition-colors duration-150 hover:text-fg-4 active:text-fg-4 disabled:pointer-events-none disabled:opacity-50'
    >
      {children}
    </button>
  );
}
