import { resolveQueue, type ShinsaState } from '@shinsa/core';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { ListRow } from '@/components/layout/list-row.tsx';
import { SectionChevron, SectionLabel } from '@/components/layout/page/section-label.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { GateGlyph, TaskGlyph, WorkingGlyph } from '@/components/status/glyphs.tsx';
import { TaskMeta } from '@/components/status/text.tsx';
import { TaskHandlePrefix } from '@/components/task/handle.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveHomeSectionFlag } from '@/lib/home.ts';
import { useStoredToggle } from '@/lib/preferences/stored-flag.ts';
import {
  listQueueSections,
  type QueueItem,
  type QueueSection,
  resolveSectionDefault,
  resolveSectionFlag,
} from '@/lib/queue.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

type Variant = 'wide' | 'compact';

function QueueItemGlyph({ state, item }: { state: ShinsaState; item: QueueItem }) {
  switch (item.kind) {
    case 'gate':
      return <GateGlyph gate={item.gate} />;
    case 'working':
      return <WorkingGlyph task={item.task} />;
    case 'idle':
      return <TaskGlyph state={state} task={item.task} />;
  }
}

export function WideSection({
  title,
  count,
  empty,
  flag,
  children,
}: {
  title: string;
  count: number;
  empty: string | null;
  flag: string;
  children: React.ReactNode;
}) {
  const [open, toggle] = useStoredToggle(flag, true);
  return (
    <section className={cn('flex flex-col gap-1', open && 'pb-1')}>
      <SectionLabel count={count} open={open} onToggle={toggle} className='px-1'>
        {title}
      </SectionLabel>
      {open && (
        <div className={cn(CARD, 'p-1 [--glyph-ring:var(--color-card)]')}>
          {count === 0 ? (
            <p className='p-2.5 text-2xs text-fg-2'>{empty}</p>
          ) : (
            <HoverHighlight className='flex flex-col gap-px'>{children}</HoverHighlight>
          )}
        </div>
      )}
    </section>
  );
}

export function WideSections({ children }: { children: React.ReactNode }) {
  return <div className='flex flex-col gap-6'>{children}</div>;
}

function CompactSection({
  section,
  activeTaskId,
  children,
}: {
  section: QueueSection;
  activeTaskId: string | null;
  children: React.ReactNode;
}) {
  const [open, onToggle] = useStoredToggle(
    resolveSectionFlag(section),
    resolveSectionDefault(section, activeTaskId)
  );
  const count = section.items.length;
  return (
    <section className='flex flex-col border-border border-t px-2 py-1.5 first-of-type:border-t-0'>
      <button
        type='button'
        aria-expanded={open}
        onClick={onToggle}
        className='group/section flex h-6 w-full cursor-pointer items-center gap-2 rounded-control ps-1.5 pe-2.5 text-left font-medium text-2xs text-fg-2 outline-none transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
      >
        <span className='grid size-5 shrink-0 place-items-center'>
          <Icon
            size='sm'
            name={section.icon}
            className={cn(section.tone !== 'neutral' && TONE_TEXT[section.tone])}
          />
        </span>
        <span className='min-w-0 truncate'>{section.title}</span>
        <span className='font-normal tabular-nums'>{count}</span>
        <span className='flex-1' />
        <SectionChevron open={open} className='opacity-0 group-hover/section:opacity-100' />
      </button>
      {open && (
        <div className='flex flex-col pt-0.5'>
          {count === 0 ? <p className='py-1 ps-8.5 pe-2.5 text-2xs text-fg-2'>{section.empty}</p> : children}
        </div>
      )}
    </section>
  );
}

function QueueSectionView({
  state,
  section,
  variant,
  activeTaskId,
  onNavigate,
}: {
  state: ShinsaState;
  section: QueueSection;
  variant: Variant;
  activeTaskId: string | null;
  onNavigate: () => void;
}) {
  if (section.items.length === 0 && section.empty === null) return null;
  const rows = section.items.map((item) => (
    <ListRow
      key={item.key}
      leading={<QueueItemGlyph state={state} item={item} />}
      active={item.task.id === activeTaskId}
      revealWhenActive={variant === 'compact'}
      title={item.task.title}
      meta={
        <>
          <TaskHandlePrefix task={item.task} />
          <TaskMeta state={state} task={item.task} />
        </>
      }
      trailing={variant === 'wide' ? <TimeAgo at={item.since} compact detail={item.sinceLabel} /> : undefined}
      onClick={() => {
        navigate(resolveTaskPath(item.task));
        onNavigate();
      }}
    />
  ));
  if (variant === 'compact') {
    return (
      <CompactSection section={section} activeTaskId={activeTaskId}>
        {rows}
      </CompactSection>
    );
  }
  return (
    <WideSection
      title={section.title}
      count={section.items.length}
      empty={section.empty}
      flag={resolveHomeSectionFlag(section.key)}
    >
      {rows}
    </WideSection>
  );
}

export function TaskQueue({
  state,
  variant,
  activeTaskId = null,
  sections = listQueueSections(state, resolveQueue(state, Date.now()), null),
  onNavigate = () => {},
}: {
  state: ShinsaState;
  variant: Variant;
  activeTaskId?: string | null;
  sections?: QueueSection[];
  onNavigate?: () => void;
}) {
  const views = sections.map((section) => (
    <QueueSectionView
      key={section.key}
      state={state}
      section={section}
      variant={variant}
      activeTaskId={activeTaskId}
      onNavigate={onNavigate}
    />
  ));
  if (variant === 'compact') return <HoverHighlight className='flex flex-col'>{views}</HoverHighlight>;
  return <>{views}</>;
}
