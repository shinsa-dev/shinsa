import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_TITLE } from '@/components/layout/page/heading.tsx';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { CARD, CARD_FOOTER } from '@/components/layout/surface/card.ts';
import { StepMark } from '@/components/overview/progress-track.tsx';
import { ToneLabel } from '@/components/status/text.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { formatSince } from '@/lib/format/time.ts';
import {
  resolveStatusCard,
  STATUS_EYEBROW,
  STATUS_LATEST_TITLE,
  STATUS_UPDATED,
  type StatusStep,
} from '@/lib/share/status.ts';
import type { SharedView } from '@/lib/share/view.ts';

function StatusSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='flex flex-col gap-1.5 border-border border-t px-4 py-3'>
      <h2 className='text-2xs text-fg-2'>{title}</h2>
      {children}
    </section>
  );
}

function StatusTimeline({ steps }: { steps: StatusStep[] }) {
  const reached = steps.filter((step) => step.status !== 'pending').length - 1;
  return (
    <ol aria-label='Progress' className='flex w-full min-w-0 items-center gap-1.5'>
      {steps.map((step, index) => (
        <React.Fragment key={step.key}>
          {index > 0 && (
            <span
              aria-hidden
              className={cn('h-px min-w-2 flex-1', step.status === 'pending' ? 'bg-bg-a3' : 'bg-green-4')}
            />
          )}
          <li className='flex shrink-0 items-center gap-1.5'>
            <StepMark status={step.status} />
            <span
              className={cn(
                'whitespace-nowrap text-2xs',
                step.status === 'pending' ? 'text-fg-2' : 'text-fg-4',
                index !== reached && 'max-sm:sr-only'
              )}
            >
              {step.label}
            </span>
          </li>
        </React.Fragment>
      ))}
    </ol>
  );
}

export function StatusCardPage({ view }: { view: SharedView }) {
  const card = resolveStatusCard(view.task, view.shared);
  return (
    <PageScroll>
      <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex max-w-xl flex-col gap-3 pb-10')}>
        <p className='flex items-center gap-1.5 text-2xs text-fg-2'>
          <Icon size='sm' name='IconProgress75' />
          <span>{STATUS_EYEBROW}</span>
          <span>·</span>
          <TimeAgo at={view.updatedAt} text={(now) => formatSince(STATUS_UPDATED, view.updatedAt, now)} />
        </p>
        <article className={cn(CARD, 'flex flex-col overflow-hidden')}>
          <header className='flex flex-col gap-1.5 px-4 py-3'>
            <ToneLabel label={card.stage.label} tone={card.stage.tone} />
            <h1 className={cn(PAGE_TITLE, 'selectable')}>{card.title}</h1>
            {card.description && <p className='selectable text-fg-3 text-xs'>{card.description}</p>}
          </header>
          <StatusSection title={STATUS_LATEST_TITLE}>
            <p className='selectable text-xs'>{card.latest}</p>
          </StatusSection>
          <div className={CARD_FOOTER}>
            <StatusTimeline steps={card.timeline} />
          </div>
        </article>
      </div>
    </PageScroll>
  );
}
