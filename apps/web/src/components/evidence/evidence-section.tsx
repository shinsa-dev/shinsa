import type { Evidence, ServiceView, ShinsaState, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CheckRowItem } from '@/components/checks/checks-list.tsx';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { EvidenceFigure, ReviewMark, UpdatedMark } from '@/components/evidence/evidence-figure.tsx';
import { EvidenceText } from '@/components/evidence/evidence-text.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { SKIPPED_OFFSCREEN } from '@/components/layout/surface/offscreen.ts';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { ImageViewer } from '@/components/overlays/image-viewer.tsx';
import {
  PREVIEW_LINK,
  PreviewLinkRow,
  TaskPreviewLinks,
  useTaskPreviews,
} from '@/components/services/task-previews.tsx';
import { useImageViewer } from '@/hooks/use-image-viewer.ts';
import { useStructuralValue } from '@/hooks/use-structural-value.ts';
import { useServerHealth } from '@/lib/connection/health.ts';
import {
  describeEvidenceKind,
  type EarlierEvidenceEntry,
  type EvidenceEntry,
  type EvidenceGroup,
  type EvidenceLayout,
  type EvidenceView,
  isVisualEvidence,
  listShownEvidenceImages,
  resolveEvidenceLayout,
  shortenHomePath,
} from '@/lib/evidence/layout.ts';
import {
  type Disclosure,
  type DisclosureId,
  extendDisclosureId,
  resolveTaskDisclosureId,
  useDisclosure,
} from '@/lib/preferences/disclosure.ts';
import { type ChecksView, resolveChecksView, resolveEvidenceCheckRow } from '@/lib/tasks/checks.ts';
import { listUnattachedPreviews, selectPreviewView } from '@/lib/terminal/services.ts';

type Viewer = ReturnType<typeof useImageViewer>;

export const EVIDENCE_EMPTY =
  'No screenshots, recordings or test runs were attached this round. Request changes to ask the agent for them.';

const EVIDENCE_ALL_REMOVED = 'The agents removed the evidence they attached this round.';

function LocalPreviews({ views }: { views: ServiceView[] }) {
  if (views.length === 0) return null;
  return (
    <section className='flex min-w-0 flex-col gap-1'>
      <SectionLabel count={views.length > 1 ? views.length : undefined}>
        {describeEvidenceKind('preview', views.length)}
      </SectionLabel>
      <TaskPreviewLinks views={views} />
    </section>
  );
}

function listAttachedUris(layout: EvidenceLayout) {
  return layout.groups
    .filter((group) => group.kind === 'preview')
    .flatMap((group) => group.entries.flatMap((entry) => entry.parts.map((part) => part.evidence.uri)));
}

function Comparison({ entry, viewer }: { entry: EvidenceEntry; viewer: Viewer }) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-1.5', SKIPPED_OFFSCREEN)}>
      <div className='flex min-w-0 flex-col gap-px'>
        <h3 className='flex min-w-0 items-center gap-1.5 text-xs'>
          <span className='min-w-0 font-medium text-fg-4'>{entry.title}</span>
          {entry.facts && <span className='shrink-0 text-2xs text-fg-2'>{entry.facts}</span>}
          {entry.fromReview && <ReviewMark />}
          {entry.updated && <UpdatedMark text={entry.updated} />}
        </h3>
        {entry.detail && <p className='selectable text-2xs text-fg-3'>{entry.detail}</p>}
      </div>
      <div
        className={cn('grid gap-2', entry.parts.length > 2 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2')}
      >
        {entry.parts.map((part) => (
          <EvidenceFigure
            key={part.evidence.id}
            view={part}
            viewer={viewer}
            label='part'
            showDetail={entry.detail === null}
          />
        ))}
      </div>
    </section>
  );
}

function LinkRow({ view, previews }: { view: EvidenceView; previews: ServiceView[] }) {
  const share = view.evidence.kind === 'preview' ? selectPreviewView(previews, view.evidence.uri) : null;
  return (
    <PreviewLinkRow share={share}>
      <a href={view.evidence.uri} target='_blank' rel='noreferrer' className={PREVIEW_LINK}>
        <Icon size='sm' name='IconArrowUpRight' className='shrink-0 text-fg-2' />
        <span className='shrink-0 font-medium text-fg-4'>{view.evidence.title}</span>
        <Truncate className='min-w-0 text-2xs text-fg-2'>{view.evidence.uri}</Truncate>
        {view.updated && <UpdatedMark text={view.updated} />}
      </a>
    </PreviewLinkRow>
  );
}

function Folder({ path }: { path: string }) {
  return (
    <div className='flex min-w-0 items-center gap-2 border-border border-t pt-2.5 text-2xs text-fg-2'>
      <Icon size='sm' name='IconFolder1' className='shrink-0' />
      <span className='shrink-0'>Stored in</span>
      <Truncate className='min-w-0 font-mono text-fg-3'>{shortenHomePath(path)}</Truncate>
      <CopyButton text={path} className='ms-auto shrink-0' />
    </div>
  );
}

function Pieces({
  group,
  viewer,
  previews = [],
}: {
  group: EvidenceGroup;
  viewer: Viewer;
  previews?: ServiceView[];
}) {
  const parts = group.entries.flatMap((entry) => entry.parts);
  const visuals = parts.filter(isVisualEvidence);
  const links = parts.filter((view) => view.media === 'file' || view.media === 'link');
  return (
    <div className='flex flex-col gap-3'>
      {visuals.length > 0 && (
        <div className='grid gap-3 sm:grid-cols-2'>
          {visuals.map((view) => (
            <EvidenceFigure key={view.evidence.id} view={view} viewer={viewer} />
          ))}
        </div>
      )}
      {parts
        .filter((view) => view.media === 'text')
        .map((view) => (
          <EvidenceText key={view.evidence.id} view={view} />
        ))}
      {links.length > 0 && (
        <div className='flex flex-col gap-1'>
          {links.map((view) => (
            <LinkRow key={view.evidence.id} view={view} previews={previews} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckLinks({ links }: { links: readonly Evidence[] }) {
  const notes = links.filter((link) => link.detail);
  if (notes.length === 0) return null;
  return (
    <span className='flex flex-col gap-px'>
      {notes.map((link) => (
        <span key={link.id} data-facts='' className='selectable text-2xs text-fg-3'>
          {link.detail}
        </span>
      ))}
    </span>
  );
}

function CheckEntries({ entries, checks }: { entries: EvidenceEntry[]; checks: ChecksView | null }) {
  return (
    <ul className={cn(INSET, 'flex min-w-0 flex-col divide-y divide-border')}>
      {entries.flatMap((entry) => {
        const check = entry.check;
        if (!check) return [];
        const row = resolveEvidenceCheckRow(checks, check, entry.title);
        return [
          <CheckRowItem key={entry.key} taskId={check.taskId} row={row}>
            <CheckLinks links={check.links} />
            {entry.fromReview && <ReviewMark />}
          </CheckRowItem>,
        ];
      })}
    </ul>
  );
}

function Group({
  group,
  viewer,
  checks,
  local = [],
  previews = [],
}: {
  group: EvidenceGroup;
  viewer: Viewer;
  checks: ChecksView | null;
  local?: ServiceView[];
  previews?: ServiceView[];
}) {
  const count = group.entries.length + local.length;
  const linked = group.entries.filter((entry) => entry.check);
  return (
    <section className={cn('flex min-w-0 flex-col gap-1', SKIPPED_OFFSCREEN)}>
      <SectionLabel count={count > 1 ? count : undefined}>
        {local.length > 0 ? describeEvidenceKind(group.kind, count) : group.label}
      </SectionLabel>
      {group.kind === 'comparison' && (
        <div className='flex flex-col gap-4'>
          {group.entries.map((entry) => (
            <Comparison key={entry.key} entry={entry} viewer={viewer} />
          ))}
        </div>
      )}
      {linked.length > 0 && <CheckEntries entries={linked} checks={checks} />}
      {group.kind !== 'comparison' && linked.length < count && (
        <Pieces
          group={{ ...group, entries: group.entries.filter((entry) => !entry.check) }}
          viewer={viewer}
          previews={previews}
        />
      )}
      {local.length > 0 && <TaskPreviewLinks views={local} />}
    </section>
  );
}

function EarlierEntry({ entry, viewer }: { entry: EarlierEvidenceEntry; viewer: Viewer }) {
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <p className='selectable text-2xs text-fg-3'>{entry.status}</p>
      {entry.kind === 'comparison' ? (
        <Comparison entry={entry} viewer={viewer} />
      ) : (
        <Pieces group={{ kind: entry.kind, label: entry.title, entries: [entry] }} viewer={viewer} />
      )}
    </div>
  );
}

function EarlierVersions({
  entries,
  disclosure,
  viewer,
}: {
  entries: EarlierEvidenceEntry[];
  disclosure: Disclosure;
  viewer: Viewer;
}) {
  return (
    <section className='flex min-w-0 flex-col gap-2'>
      <DisclosureHeader
        disclosure={disclosure}
        label='Earlier versions'
        strip='line'
        chevron='glyph'
        className='w-fit gap-1 font-medium text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
      >
        Earlier versions
        <span className='font-normal tabular-nums'>{entries.length}</span>
      </DisclosureHeader>
      {disclosure.open && (
        <div className='flex flex-col gap-4'>
          {entries.map((entry) => (
            <EarlierEntry key={entry.key} entry={entry} viewer={viewer} />
          ))}
        </div>
      )}
    </section>
  );
}

function EvidenceBody({
  layout,
  checks,
  persistId,
  previews,
}: {
  layout: EvidenceLayout;
  checks: ChecksView | null;
  persistId: DisclosureId;
  previews: ServiceView[];
}) {
  const viewer = useImageViewer();
  const earlier = useDisclosure(extendDisclosureId(persistId, 'earlier'), false);
  const local = listUnattachedPreviews(previews, listAttachedUris(layout));
  const attached = layout.groups.some((group) => group.kind === 'preview');
  return (
    <div className='flex flex-col gap-5'>
      {layout.count === 0 && <p className='text-fg-2 text-xs'>{EVIDENCE_ALL_REMOVED}</p>}
      {layout.groups.map((group) => (
        <Group
          key={group.kind}
          group={group}
          viewer={viewer}
          checks={checks}
          local={group.kind === 'preview' ? local : []}
          previews={previews}
        />
      ))}
      {!attached && <LocalPreviews views={local} />}
      {layout.earlier.length > 0 && (
        <EarlierVersions entries={layout.earlier} disclosure={earlier} viewer={viewer} />
      )}
      {layout.folder && <Folder path={layout.folder} />}
      <ImageViewer images={listShownEvidenceImages(layout, earlier.open)} viewer={viewer} />
    </div>
  );
}

const NO_PREVIEWS: ServiceView[] = [];

export const EvidencePanel = React.memo(function EvidencePanelView({
  layout,
  persistId,
  checks = null,
  previews = NO_PREVIEWS,
}: {
  layout: EvidenceLayout;
  persistId: DisclosureId;
  checks?: ChecksView | null;
  previews?: ServiceView[];
}) {
  return (
    <Panel persistId={persistId} title='Evidence' icon='IconImages1' count={layout.count}>
      <EvidenceBody layout={layout} checks={checks} persistId={persistId} previews={previews} />
    </Panel>
  );
});

export function EvidenceSection({
  state,
  task,
  showEmpty = false,
}: {
  state: ShinsaState;
  task: Task;
  showEmpty?: boolean;
}) {
  const dataDir = useServerHealth()?.dataDir ?? null;
  const { evidence, runs, repos } = state;
  const layout = useStructuralValue(
    React.useMemo(
      () => resolveEvidenceLayout({ evidence, runs }, task, dataDir),
      [evidence, runs, task, dataDir]
    )
  );
  const checks = useStructuralValue(
    React.useMemo(() => resolveChecksView({ evidence, repos }, task), [evidence, repos, task])
  );
  const previews = useStructuralValue(useTaskPreviews(state, task));
  const persistId = resolveTaskDisclosureId(task.id, 'evidence', 'panel');
  if (layout.count === 0 && layout.earlier.length === 0) {
    if (!(showEmpty || previews.length > 0)) return null;
    return (
      <Panel persistId={persistId} title='Evidence' icon='IconImages1'>
        <div className='flex flex-col gap-5'>
          <p className='text-fg-2 text-xs'>{EVIDENCE_EMPTY}</p>
          <LocalPreviews views={previews} />
        </div>
      </Panel>
    );
  }
  return <EvidencePanel layout={layout} persistId={persistId} checks={checks} previews={previews} />;
}
