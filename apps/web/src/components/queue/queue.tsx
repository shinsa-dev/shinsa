import { resolveBundle, type ShinsaState, type Task } from '@shinsa/core';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CompactSection, CompactSections } from '@/components/layout/compact-section.tsx';
import { ListRow } from '@/components/layout/list-row.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { SectionChevron } from '@/components/layout/page/section-label.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { RowSummary } from '@/components/queue/row-summary.tsx';
import { SharedMark } from '@/components/share/shared-mark.tsx';
import { GateGlyph, TaskGlyph, WorkingGlyph } from '@/components/status/glyphs.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
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
  describeGroupHidden,
  describeGroupSummary,
  describeGroupToggle,
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

function QueueItemRow({
  context,
  item,
  fold,
  indent = false,
  extraMark,
}: {
  context: RowContext;
  item: QueueItem;
  fold?: React.ReactNode;
  indent?: boolean;
  extraMark?: React.ReactNode;
}) {
  const { state, variant } = context;
  const marks = renderMarks(state, item.task);
  return (
    <ListRow
      fold={fold}
      indent={indent}
      holdsLinks={fold !== undefined}
      leading={<QueueItemGlyph state={state} item={item} />}
      active={item.task.id === context.activeTaskId}
      revealWhenActive={variant === 'compact'}
      title={item.task.title}
      mark={
        marks || extraMark ? (
          <>
            {marks}
            {extraMark}
          </>
        ) : undefined
      }
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

function GroupFold({ group, open, onToggle }: { group: QueueGroup; open: boolean; onToggle: () => void }) {
  return (
    <button
      type='button'
      aria-expanded={open}
      aria-label={describeGroupToggle(group, open)}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className='corner-superellipse/1.125 grid size-4 cursor-pointer place-items-center rounded-control-sm text-fg-2 outline-none hover:text-fg-4 active:text-fg-4'
    >
      <SectionChevron open={open} />
    </button>
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
  const fold = <GroupFold group={group} open={open} onToggle={() => disclosure.replaceOpen(!open)} />;
  const members = open
    ? group.members.map((item) => <QueueItemRow key={item.key} context={context} item={item} indent />)
    : null;
  if (group.root) {
    const hidden = open ? undefined : (
      <Hint label={describeGroupHidden(group)}>
        <span className='shrink-0 text-2xs text-fg-2 tabular-nums'>+{group.members.length}</span>
      </Hint>
    );
    return (
      <>
        <QueueItemRow context={context} item={group.root} fold={fold} extraMark={hidden} />
        {members}
      </>
    );
  }
  const lead = group.opens;
  return (
    <>
      <ListRow
        fold={fold}
        holdsLinks
        leading={<StatusTile icon={INITIATIVE_ICON} tone='neutral' label='Initiative' />}
        active={lead !== null && lead.id === context.activeTaskId}
        revealWhenActive={context.variant === 'compact'}
        title={group.title}
        summary={<span className='truncate'>{describeGroupSummary(group)}</span>}
        onClick={() => (lead ? openTask(context, lead) : disclosure.replaceOpen(!open))}
      />
      {members}
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
