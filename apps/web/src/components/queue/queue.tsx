import { resolveQueue, type ShinsaState } from '@shinsa/core';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CompactSection, CompactSections } from '@/components/layout/compact-section.tsx';
import { ListRow } from '@/components/layout/list-row.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { GateGlyph, TaskGlyph, WorkingGlyph } from '@/components/status/glyphs.tsx';
import { TaskMeta } from '@/components/status/text.tsx';
import { TaskHandlePrefix } from '@/components/task/handle.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useProgressiveCount } from '@/hooks/use-progressive-count.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveHomeSectionId } from '@/lib/home.ts';
import { type DisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import {
  listQueueSections,
  type QueueItem,
  type QueueSection,
  resolveSectionDefault,
  resolveSectionId,
} from '@/lib/queue.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

type Variant = 'wide' | 'compact';

const FIRST_ROWS = 24;

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
  persistId,
  children,
}: {
  title: string;
  count: number;
  empty: string | null;
  persistId: DisclosureId;
  children: React.ReactNode;
}) {
  const disclosure = useDisclosure(persistId, true);
  return (
    <section className={cn('flex flex-col gap-1', disclosure.open && 'pb-1')}>
      <SectionLabel count={count} disclosure={disclosure} className='px-1'>
        {title}
      </SectionLabel>
      {disclosure.open && (
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

function QueueCompactSection({
  section,
  activeTaskId,
  children,
}: {
  section: QueueSection;
  activeTaskId: string | null;
  children: React.ReactNode;
}) {
  const count = section.items.length;
  return (
    <CompactSection
      persistId={resolveSectionId(section)}
      defaultOpen={resolveSectionDefault(section, activeTaskId)}
      leading={
        <Icon
          size='sm'
          name={section.icon}
          className={cn(section.tone !== 'neutral' && TONE_TEXT[section.tone])}
        />
      }
      title={section.title}
      count={count}
    >
      {count === 0 ? <p className='py-1 ps-8.5 pe-2.5 text-2xs text-fg-2'>{section.empty}</p> : children}
    </CompactSection>
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
  const shown = useProgressiveCount(section.items.length, FIRST_ROWS);
  if (section.items.length === 0 && section.empty === null) return null;
  const rows = section.items.slice(0, shown).map((item) => (
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
      <QueueCompactSection section={section} activeTaskId={activeTaskId}>
        {rows}
      </QueueCompactSection>
    );
  }
  return (
    <WideSection
      title={section.title}
      count={section.items.length}
      empty={section.empty}
      persistId={resolveHomeSectionId(section.key)}
    >
      {rows}
    </WideSection>
  );
}

export function TaskQueue({
  state,
  variant,
  activeTaskId = null,
  sections = listQueueSections(state, resolveQueue(state, Date.now())),
  className,
  onNavigate = () => {},
}: {
  state: ShinsaState;
  variant: Variant;
  activeTaskId?: string | null;
  sections?: QueueSection[];
  className?: string;
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
  if (variant === 'compact') return <CompactSections className={className}>{views}</CompactSections>;
  return <>{views}</>;
}
