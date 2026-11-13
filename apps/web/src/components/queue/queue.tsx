import { resolveBundle, type ShinsaState, type Task } from '@shinsa/core';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CompactSection, CompactSections } from '@/components/layout/compact-section.tsx';
import { ListRow } from '@/components/layout/list-row.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { RowSummary } from '@/components/queue/row-summary.tsx';
import { SharedMark } from '@/components/share/shared-mark.tsx';
import { GateGlyph, TaskGlyph, WorkingGlyph } from '@/components/status/glyphs.tsx';
import { BundleMark } from '@/components/task/bundle.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useOwnQueue } from '@/hooks/use-own-queue.ts';
import { useProgressiveCount } from '@/hooks/use-progressive-count.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveHomeSectionId } from '@/lib/home.ts';
import { INITIATIVE_ICON } from '@/lib/initiatives/view.ts';
import { type DisclosureId, useDisclosure, useDisclosureSet } from '@/lib/preferences/disclosure.ts';
import {
  countSectionEntries,
  describeGroupSummary,
  listQueueSections,
  type QueueEntry,
  type QueueGroup,
  type QueueItem,
  type QueueSection,
  resolveGroupDefault,
  resolveGroupId,
  resolveGroupOpen,
  resolveGroupPrefix,
  resolveSectionDefault,
  resolveSectionId,
} from '@/lib/queue.ts';
import { hasShareMark } from '@/lib/share/dialog.ts';
import { BUNDLE_ICON } from '@/lib/tasks/bundles.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

type Variant = 'wide' | 'compact';

const FIRST_ROWS = 24;

function renderMarks(state: ShinsaState, task: Task) {
  const shared = hasShareMark(task);
  const bundled = resolveBundle(state, task).length > 0;
  if (!shared && !bundled) return undefined;
  return (
    <>
      {shared && <SharedMark task={task} />}
      {bundled && <BundleMark state={state} task={task} />}
    </>
  );
}

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
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  empty: string | null;
  persistId: DisclosureId;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const disclosure = useDisclosure(persistId, defaultOpen);
  return (
    <section className={cn('flex flex-col gap-1', disclosure.open && 'pb-1')}>
      <SectionLabel count={count} disclosure={disclosure} className='px-1'>
        {title}
      </SectionLabel>
      {disclosure.open && (
        <div className={cn(CARD, 'p-1')}>
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
  count,
  activeTaskId,
  children,
}: {
  section: QueueSection;
  count: number;
  activeTaskId: string | null;
  children: React.ReactNode;
}) {
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

interface RowContext {
  state: ShinsaState;
  variant: Variant;
  activeTaskId: string | null;
  onNavigate: () => void;
}

function openTask(context: RowContext, task: Task) {
  navigate(resolveTaskPath(task));
  context.onNavigate();
}

function QueueItemRow({ context, item }: { context: RowContext; item: QueueItem }) {
  const { state, variant } = context;
  return (
    <ListRow
      leading={<QueueItemGlyph state={state} item={item} />}
      active={item.task.id === context.activeTaskId}
      revealWhenActive={variant === 'compact'}
      title={item.task.title}
      mark={renderMarks(state, item.task)}
      summary={
        <RowSummary
          state={state}
          task={item.task}
          gate={item.kind === 'gate' ? item.gate : null}
          detail={variant === 'wide'}
        />
      }
      trailing={variant === 'wide' ? <TimeAgo at={item.since} compact detail={item.sinceLabel} /> : undefined}
      onClick={() => openTask(context, item.task)}
    />
  );
}

const GROUP_ICON: Record<QueueGroup['kind'], IconName> = { initiative: INITIATIVE_ICON, bundle: BUNDLE_ICON };

function QueueGroupHeader({
  context,
  group,
  open,
  onToggle,
}: {
  context: RowContext;
  group: QueueGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const lead = group.kind === 'initiative' ? group.opens : null;
  return (
    <div className='relative flex h-6 min-w-0 items-center gap-1.5 px-2.5 text-2xs text-fg-2'>
      <button
        type='button'
        aria-expanded={open}
        aria-label={group.title}
        onClick={onToggle}
        className='peer absolute inset-0 cursor-pointer rounded-control-sm outline-none'
      />
      <Icon name={GROUP_ICON[group.kind]} size='sm' className='shrink-0' />
      {lead ? (
        <button
          type='button'
          onClick={() => openTask(context, lead)}
          className='relative min-w-0 shrink cursor-pointer truncate font-medium text-fg-3 outline-none hover:text-fg-4 hover:underline active:text-fg-4 active:underline'
        >
          {group.title}
        </button>
      ) : (
        <span className='min-w-0 shrink truncate font-medium text-fg-3 peer-hover:text-fg-4'>
          {group.title}
        </span>
      )}
      <span className='pointer-events-none shrink-0 tabular-nums peer-hover:text-fg-3'>
        {describeGroupSummary(group)}
      </span>
    </div>
  );
}

function QueueGroupRows({
  context,
  scope,
  section,
  group,
  open,
}: {
  context: RowContext;
  scope: 'home' | 'queue';
  section: QueueSection;
  group: QueueGroup;
  open: boolean;
}) {
  const disclosure = useDisclosure(resolveGroupId(scope, section, group), open);
  const items = group.root ? [group.root, ...group.members] : group.members;
  return (
    <>
      <QueueGroupHeader
        context={context}
        group={group}
        open={open}
        onToggle={() => disclosure.replaceOpen(!open)}
      />
      {open && (
        <div className='ms-4 flex flex-col border-s border-border ps-1'>
          {items.map((item) => (
            <QueueItemRow key={item.key} context={context} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

function useGroupOpen(scope: 'home' | 'queue', section: QueueSection, activeTaskId: string | null) {
  const prefix = resolveGroupPrefix(scope, section);
  const [opened] = useDisclosureSet(prefix, true);
  const [folded] = useDisclosureSet(prefix, false);
  return (group: QueueGroup) =>
    resolveGroupOpen(group, opened, folded, resolveGroupDefault(section, group, activeTaskId));
}

function QueueEntryRows({
  context,
  scope,
  section,
  entry,
  isOpen,
}: {
  context: RowContext;
  scope: 'home' | 'queue';
  section: QueueSection;
  entry: QueueEntry;
  isOpen: (group: QueueGroup) => boolean;
}) {
  if (entry.kind === 'item') return <QueueItemRow context={context} item={entry.item} />;
  return (
    <QueueGroupRows
      context={context}
      scope={scope}
      section={section}
      group={entry.group}
      open={isOpen(entry.group)}
    />
  );
}

function resolveEntryKey(entry: QueueEntry) {
  return entry.kind === 'item' ? entry.item.key : entry.group.key;
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
  const scope = variant === 'compact' ? 'queue' : 'home';
  const isOpen = useGroupOpen(scope, section, activeTaskId);
  const shown = useProgressiveCount(section.entries.length, FIRST_ROWS);
  if (section.items.length === 0 && section.empty === null) return null;
  const context = { state, variant, activeTaskId, onNavigate };
  const count = countSectionEntries(section.entries, isOpen);
  const rows = section.entries
    .slice(0, shown)
    .map((entry) => (
      <QueueEntryRows
        key={resolveEntryKey(entry)}
        context={context}
        scope={scope}
        section={section}
        entry={entry}
        isOpen={isOpen}
      />
    ));
  if (variant === 'compact') {
    return (
      <QueueCompactSection section={section} count={count} activeTaskId={activeTaskId}>
        {rows}
      </QueueCompactSection>
    );
  }
  return (
    <WideSection
      title={section.title}
      count={count}
      empty={section.empty}
      persistId={resolveHomeSectionId(section.key)}
      defaultOpen={section.opensOnHome}
    >
      {rows}
    </WideSection>
  );
}

export function TaskQueue({
  state,
  variant,
  activeTaskId = null,
  sections: given,
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
  const own = useOwnQueue(state);
  const sections = given ?? listQueueSections(state, own);
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
