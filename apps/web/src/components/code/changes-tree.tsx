import type { DiffFile, TaskDiff } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { TREE_LIST, TREE_ROW_HEIGHT, TreeRow } from '@/components/code/tree-row.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { VirtualRows } from '@/components/settings/virtual-rows.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { resolveFileIcon, resolveFolderIcon } from '@/lib/code/file-icons.ts';
import { scheduleIdle } from '@/lib/code/prefetch.ts';
import {
  FILE_STATUS,
  findActiveGuide,
  listChangeRows,
  listNeighbourPaths,
  listShownChanges,
  pickGuideLevel,
  sumChanges,
} from '@/lib/code/tree.ts';
import { formatCount } from '@/lib/format/count.ts';
import { useHideViewed } from '@/lib/preferences/code.ts';
import { type DisclosureId, useDisclosureSet } from '@/lib/preferences/disclosure.ts';

export function StatusLetter({ status, muted = false }: { status: DiffFile['status']; muted?: boolean }) {
  return (
    <Hint label={FILE_STATUS[status].name}>
      <span
        className={cn(
          'inline-flex w-2 shrink-0 justify-center font-medium text-2xs',
          muted ? 'text-fg-1' : FILE_STATUS[status].className
        )}
      >
        {FILE_STATUS[status].letter}
      </span>
    </Hint>
  );
}

function ViewedBox({ viewed, onToggle }: { viewed: boolean; onToggle: () => void }) {
  return (
    <Checkbox
      size='sm'
      aria-label='Viewed'
      checked={viewed}
      onCheckedChange={onToggle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function RiskDot({ file, muted }: { file: DiffFile; muted: boolean }) {
  if (file.risk !== 'high') return null;
  return (
    <Hint
      label={
        <span className='flex flex-col items-start'>
          <span className='text-red-text'>High risk</span>
          {file.riskReason && <TooltipLabel>{file.riskReason}</TooltipLabel>}
        </span>
      }
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', muted ? 'bg-fg-1' : 'bg-red-4')} />
    </Hint>
  );
}

function FileEnd({
  file,
  comments,
  viewed,
  muted,
  onToggleViewed,
}: {
  file: DiffFile;
  comments: number;
  viewed: boolean;
  muted: boolean;
  onToggleViewed: () => void;
}) {
  return (
    <span className='flex shrink-0 items-center gap-1.5'>
      <RiskDot file={file} muted={muted} />
      {comments > 0 && (
        <Hint label={`${formatCount(comments, 'comment', 'comments')} from you`}>
          <span
            className={cn(
              'inline-flex w-fit text-2xs tabular-nums',
              muted ? 'text-fg-1' : 'text-primary-text'
            )}
          >
            {comments}
          </span>
        </Hint>
      )}
      {file.binary ? (
        <span className={cn('text-2xs', muted ? 'text-fg-1' : 'text-fg-2')}>Binary</span>
      ) : (
        <DiffStats added={file.additions} removed={file.deletions} muted={muted} />
      )}
      <StatusLetter status={file.status} muted={muted} />
      <ViewedBox viewed={viewed} onToggle={onToggleViewed} />
    </span>
  );
}

interface FileRowActions {
  open: (path: string) => void;
  prefetch: (path: string) => void;
  toggleViewed: (path: string) => void;
}

const ChangeFileRow = React.memo(function ChangedFileRow({
  path,
  name,
  depth,
  guide,
  selected,
  file,
  comments,
  viewed,
  actions,
}: {
  path: string;
  name: string;
  depth: number;
  guide: number | undefined;
  selected: boolean;
  file: DiffFile | null;
  comments: number;
  viewed: boolean;
  actions: FileRowActions;
}) {
  const muted = viewed && !selected;
  return (
    <TreeRow
      depth={depth}
      guide={guide}
      selected={selected}
      label={path}
      icon={resolveFileIcon(path)}
      className={cn(muted && 'file-icons-muted text-fg-1')}
      onOpen={() => actions.open(path)}
      onPrefetch={() => actions.prefetch(path)}
      end={
        file && (
          <FileEnd
            file={file}
            comments={comments}
            viewed={viewed}
            muted={muted}
            onToggleViewed={() => actions.toggleViewed(path)}
          />
        )
      }
    >
      <Truncate className='flex-1'>{name}</Truncate>
    </TreeRow>
  );
});

function HideViewedToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  const label = hidden ? 'Show viewed files' : 'Hide viewed files';
  return (
    <Hint label={label}>
      <Button
        variant='secondary'
        size='icon-xs'
        icon={hidden ? 'IconEyeSlash' : 'IconEyeOpen'}
        aria-label='Hide viewed files'
        aria-pressed={hidden}
        className={hidden ? 'bg-bg-a3 text-fg-4' : undefined}
        onClick={onToggle}
      />
    </Hint>
  );
}

export function ChangesTree({
  diff,
  activePath,
  commentCounts,
  viewed,
  onToggleViewed,
  onOpen,
  onPrefetch,
}: {
  persistId: DisclosureId;
  diff: TaskDiff;
  activePath: string | null;
  commentCounts: ReadonlyMap<string, number>;
  viewed: ReadonlySet<string>;
  onToggleViewed: (path: string) => void;
  onOpen: (path: string) => void;
  onPrefetch: (path: string) => void;
}) {
  const [collapsed, markCollapsed] = useDisclosureSet(persistId, false);
  const [hideViewed, toggleHideViewed] = useHideViewed();
  const shown = React.useMemo(
    () => listShownChanges(diff.files, viewed, hideViewed, activePath),
    [diff.files, viewed, hideViewed, activePath]
  );
  const rows = React.useMemo(() => listChangeRows(shown, collapsed), [shown, collapsed]);
  const guide = findActiveGuide(rows, activePath);
  const paths = React.useMemo(() => rows.flatMap((row) => (row.kind === 'file' ? [row.path] : [])), [rows]);
  const neighbours = listNeighbourPaths(paths, activePath).join('\n');
  const latest = React.useRef({ onOpen, onPrefetch, onToggleViewed });
  latest.current = { onOpen, onPrefetch, onToggleViewed };
  const actions = React.useMemo<FileRowActions>(
    () => ({
      open: (path) => latest.current.onOpen(path),
      prefetch: (path) => latest.current.onPrefetch(path),
      toggleViewed: (path) => latest.current.onToggleViewed(path),
    }),
    []
  );
  React.useEffect(
    () =>
      scheduleIdle(() => {
        for (const path of neighbours.split('\n')) if (path) actions.prefetch(path);
      }),
    [neighbours, actions]
  );
  const totals = React.useMemo(() => sumChanges(diff.files), [diff.files]);
  const seen = React.useMemo(
    () => diff.files.filter((file) => viewed.has(file.path)).length,
    [diff.files, viewed]
  );
  const hiddenCount = diff.files.length - shown.length;
  if (diff.files.length === 0) {
    return <p className='px-3 py-2.5 text-2xs text-fg-2'>Nothing on this branch differs from its base.</p>;
  }
  return (
    <div className={TREE_LIST}>
      <div className='flex h-5.5 items-center gap-2 ps-1 text-2xs text-fg-2'>
        <span className='flex-1'>
          {formatCount(diff.files.length, 'file', 'files')} ·{' '}
          {hideViewed && hiddenCount > 0 ? `${hiddenCount} viewed hidden` : `${seen} viewed`}
        </span>
        <DiffStats added={totals.added} removed={totals.removed} />
        <HideViewedToggle hidden={hideViewed} onToggle={toggleHideViewed} />
      </div>
      {rows.length === 0 && <p className='py-1 ps-1 text-2xs text-fg-2'>Every file is viewed.</p>}
      <div role='tree' aria-label='Changed files' className='flex flex-col'>
        <VirtualRows items={rows} rowHeight={TREE_ROW_HEIGHT} keyOf={(row) => `${row.kind}:${row.path}`}>
          {(row) => {
            if (row.kind === 'directory') {
              return (
                <TreeRow
                  depth={row.depth}
                  guide={pickGuideLevel(guide, row.path)}
                  expanded={!collapsed.has(row.path)}
                  icon={resolveFolderIcon(row.path, !collapsed.has(row.path))}
                  label={row.path}
                  onOpen={() => {
                    const next = new Set(collapsed);
                    if (next.has(row.path)) next.delete(row.path);
                    else next.add(row.path);
                    setCollapsed(next);
                  }}
                >
                  <Truncate className='flex-1 text-fg-2'>{row.name}</Truncate>
                </TreeRow>
              );
            }
            return (
              <ChangeFileRow
                path={row.path}
                name={row.name}
                depth={row.depth}
                guide={pickGuideLevel(guide, row.path)}
                selected={row.path === activePath}
                file={row.file}
                comments={commentCounts.get(row.path) ?? 0}
                viewed={viewed.has(row.path)}
                actions={actions}
              />
            );
          }}
        </VirtualRows>
      </div>
    </div>
  );
}
