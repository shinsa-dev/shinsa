import type { ShinsaState, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { EvidenceFigure, ReviewMark } from '@/components/evidence/evidence-figure.tsx';
import { EvidenceText } from '@/components/evidence/evidence-text.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { ImageViewer } from '@/components/overlays/image-viewer.tsx';
import { useImageViewer } from '@/hooks/use-image-viewer.ts';
import { useServerHealth } from '@/lib/connection/health.ts';
import {
  type EvidenceEntry,
  type EvidenceGroup,
  type EvidenceLayout,
  type EvidenceView,
  isVisualEvidence,
  resolveEvidenceLayout,
  shortenHomePath,
} from '@/lib/evidence/layout.ts';
import { type DisclosureId, resolveTaskDisclosureId } from '@/lib/preferences/disclosure.ts';

type Viewer = ReturnType<typeof useImageViewer>;

export const EVIDENCE_EMPTY =
  'No screenshots, recordings or test runs were attached this round. Request changes to ask the agent for them.';

function Comparison({ entry, viewer }: { entry: EvidenceEntry; viewer: Viewer }) {
  return (
    <section className='flex min-w-0 flex-col gap-1.5'>
      <div className='flex min-w-0 flex-col gap-px'>
        <h3 className='flex min-w-0 items-center gap-1.5 text-xs'>
          <span className='min-w-0 font-medium text-fg-4'>{entry.title}</span>
          {entry.facts && <span className='shrink-0 text-2xs text-fg-2'>{entry.facts}</span>}
          {entry.fromReview && <ReviewMark />}
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

function LinkRow({ view }: { view: EvidenceView }) {
  return (
    <a
      href={view.evidence.uri}
      target='_blank'
      rel='noreferrer'
      className='corner-superellipse/1.125 flex h-8 min-w-0 items-center gap-2 rounded-control bg-bg-2 px-2.5 text-xs hover:bg-bg-3 active:bg-bg-3'
    >
      <Icon size='sm' name='IconArrowUpRight' className='shrink-0 text-fg-2' />
      <span className='shrink-0 font-medium text-fg-4'>{view.evidence.title}</span>
      <Truncate className='min-w-0 text-2xs text-fg-2'>{view.evidence.uri}</Truncate>
    </a>
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

function Pieces({ group, viewer }: { group: EvidenceGroup; viewer: Viewer }) {
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
            <LinkRow key={view.evidence.id} view={view} />
          ))}
        </div>
      )}
    </div>
  );
}

function Group({ group, viewer }: { group: EvidenceGroup; viewer: Viewer }) {
  const count = group.entries.length;
  return (
    <section className='flex min-w-0 flex-col gap-1'>
      <SectionLabel count={count > 1 ? count : undefined}>{group.label}</SectionLabel>
      {group.kind === 'comparison' ? (
        <div className='flex flex-col gap-4'>
          {group.entries.map((entry) => (
            <Comparison key={entry.key} entry={entry} viewer={viewer} />
          ))}
        </div>
      ) : (
        <Pieces group={group} viewer={viewer} />
      )}
    </section>
  );
}

function EvidenceBody({ layout }: { layout: EvidenceLayout }) {
  const viewer = useImageViewer();
  return (
    <div className='flex flex-col gap-5'>
      {layout.groups.map((group) => (
        <Group key={group.kind} group={group} viewer={viewer} />
      ))}
      {layout.folder && <Folder path={layout.folder} />}
      <ImageViewer images={layout.images} viewer={viewer} />
    </div>
  );
}

export function EvidencePanel({ layout, persistId }: { layout: EvidenceLayout; persistId: DisclosureId }) {
  return (
    <Panel persistId={persistId} title='Evidence' icon='IconImages1' count={layout.count}>
      <EvidenceBody layout={layout} />
    </Panel>
  );
}

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
  const { evidence, runs } = state;
  const layout = React.useMemo(
    () => resolveEvidenceLayout({ evidence, runs }, task, dataDir),
    [evidence, runs, task, dataDir]
  );
  const persistId = resolveTaskDisclosureId(task.id, 'evidence', 'panel');
  if (layout.count === 0) {
    if (!showEmpty) return null;
    return (
      <Panel persistId={persistId} title='Evidence' icon='IconImages1'>
        <p className='text-fg-2 text-xs'>{EVIDENCE_EMPTY}</p>
      </Panel>
    );
  }
  return <EvidencePanel layout={layout} persistId={persistId} />;
}
