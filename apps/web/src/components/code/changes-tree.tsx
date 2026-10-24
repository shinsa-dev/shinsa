import type { DiffFile, TaskDiff } from '@shinsa/core';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { TreeRow } from '@/components/code/tree-row.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { CheckMark } from '@/components/status/check-mark.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { FILE_STATUS, listChangeRows, sumChanges } from '@/lib/code/tree.ts';
import { formatCount } from '@/lib/format/count.ts';

export function StatusLetter({ status, plain = false }: { status: DiffFile['status']; plain?: boolean }) {
  const letter = (
    <span className={cn('inline-flex w-fit font-medium text-2xs', FILE_STATUS[status].className)}>
      {FILE_STATUS[status].letter}
    </span>
  );
  if (plain) return letter;
  return <Hint label={FILE_STATUS[status].name}>{letter}</Hint>;
}

function RiskDot({ file }: { file: DiffFile }) {
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
      <span className='size-1.5 shrink-0 rounded-full bg-red-4' />
    </Hint>
  );
}

function FileEnd({
  file,
  comments,
  viewed,
  onToggleViewed,
}: {
  file: DiffFile;
  comments: number;
  viewed: boolean;
  onToggleViewed: () => void;
}) {
  return (
    <span className='flex shrink-0 items-center gap-1.5'>
      <RiskDot file={file} />
      {comments > 0 && (
        <Hint label={`${formatCount(comments, 'comment', 'comments')} from you`}>
          <span className='inline-flex w-fit text-2xs text-primary-text tabular-nums'>{comments}</span>
        </Hint>
      )}
      {file.binary ? (
        <span className='text-2xs text-fg-2'>Binary</span>
      ) : (
        <DiffStats added={file.additions} removed={file.deletions} />
      )}
      <Hint label={viewed ? 'Viewed. Click to mark as not viewed' : 'Mark as viewed'}>
        <button
          type='button'
          aria-label={viewed ? 'Mark as not viewed' : 'Mark as viewed'}
          aria-pressed={viewed}
          onClick={(event) => {
            event.stopPropagation();
            onToggleViewed();
          }}
          className='grid size-4 cursor-pointer place-items-center rounded-sm border border-border transition-colors duration-150 hover:bg-bg-a2 active:bg-bg-a2'
        >
          {viewed && <CheckMark />}
        </button>
      </Hint>
    </span>
  );
}

export function ChangesTree({
  diff,
  activePath,
  commentCounts,
  viewed,
  onToggleViewed,
  onOpen,
}: {
  diff: TaskDiff;
  activePath: string | null;
  commentCounts: ReadonlyMap<string, number>;
  viewed: ReadonlySet<string>;
  onToggleViewed: (path: string) => void;
  onOpen: (path: string, pin: boolean) => void;
}) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const rows = React.useMemo(() => listChangeRows(diff.files, collapsed), [diff.files, collapsed]);
  const totals = sumChanges(diff.files);
  const seen = diff.files.filter((file) => viewed.has(file.path)).length;
  if (diff.files.length === 0) {
    return <p className='px-3 py-2.5 text-2xs text-fg-2'>Nothing on this branch differs from its base.</p>;
  }
  return (
    <div className='flex flex-col gap-1 p-1.5'>
      <div className='flex h-6 items-center gap-2 px-1.5 text-2xs text-fg-2'>
        <span className='flex-1'>
          {formatCount(diff.files.length, 'file', 'files')} · {seen} viewed
        </span>
        <DiffStats added={totals.added} removed={totals.removed} />
      </div>
      <div role='tree' aria-label='Changed files' className='flex flex-col'>
        {rows.map((row) =>
          row.kind === 'directory' ? (
            <TreeRow
              key={`d:${row.path}`}
              depth={row.depth}
              expanded={!collapsed.has(row.path)}
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
          ) : (
            <TreeRow
              key={`f:${row.path}`}
              depth={row.depth}
              selected={row.path === activePath}
              label={row.path}
              lead={row.file && <StatusLetter status={row.file.status} />}
              onOpen={() => onOpen(row.path, false)}
              onPin={() => onOpen(row.path, true)}
              end={
                row.file && (
                  <FileEnd
                    file={row.file}
                    comments={commentCounts.get(row.path) ?? 0}
                    viewed={viewed.has(row.path)}
                    onToggleViewed={() => onToggleViewed(row.path)}
                  />
                )
              }
            >
              <Truncate className={cn('flex-1', viewed.has(row.path) && 'text-fg-2')}>{row.name}</Truncate>
            </TreeRow>
          )
        )}
      </div>
    </div>
  );
}
