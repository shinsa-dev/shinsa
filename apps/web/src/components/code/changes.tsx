import type { DiffFile, Task, TaskDiff } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CodeView } from '@/components/code/code-view.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { DiffStatsLabel } from '@/components/text/diff-stats.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { FILE_STATUS, listFileGroups, sumChanges } from '@/lib/code/file-groups.ts';
import { openWorktree } from '@/lib/connection/worktree.ts';
import { formatCount } from '@/lib/format/count.ts';
import { listFindingMarkers } from '@/lib/review/targets.ts';
import { useSearchParam } from '@/router.ts';

function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <Hint label={<DiffStatsLabel added={added} removed={removed} />}>
      <span className='shrink-0 tabular-nums'>
        <span className='text-green-text'>+{added}</span> <span className='text-red-text'>−{removed}</span>
      </span>
    </Hint>
  );
}

function FileRow({
  file,
  selected,
  comments,
  onSelect,
}: {
  file: DiffFile;
  selected: boolean;
  comments: number;
  onSelect: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(
        'corner-superellipse/1.125 flex h-6 w-full cursor-pointer items-center gap-2 rounded-control-sm px-2 text-left text-2xs transition-colors duration-150',
        selected ? 'bg-bg-a3' : 'hover:bg-bg-a2 active:bg-bg-a2'
      )}
    >
      <Hint label={FILE_STATUS[file.status].name}>
        <span className={cn('w-3 shrink-0 font-medium', FILE_STATUS[file.status].className)}>
          {FILE_STATUS[file.status].letter}
        </span>
      </Hint>
      <Truncate className='flex-1 text-fg-4'>{file.path.split('/').at(-1)}</Truncate>
      {file.risk === 'high' && (
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
      )}
      {comments > 0 && (
        <Hint label={`${formatCount(comments, 'comment', 'comments')} from you`}>
          <span className='shrink-0 text-primary-text tabular-nums'>{comments}</span>
        </Hint>
      )}
      <LineCounts added={file.additions} removed={file.deletions} />
    </button>
  );
}

export function ChangesPane({ task, diff }: { task: Task; diff: TaskDiff }) {
  const linkedPath = useSearchParam('file');
  const draft = useReviewDraft();
  const [picked, setPicked] = React.useState({ linkedPath, path: linkedPath });
  const groups = React.useMemo(() => listFileGroups(diff.files), [diff.files]);
  const totals = sumChanges(diff.files);
  const selectedPath = picked.linkedPath === linkedPath ? picked.path : linkedPath;
  const ordered = groups.flatMap((group) => group.files);
  const selected = ordered.find((file) => file.path === selectedPath) ?? ordered[0] ?? null;

  return (
    <div className='flex min-h-0 flex-1 max-md:flex-col'>
      <aside className='flex w-70 shrink-0 flex-col border-border border-r max-md:max-h-2/5 max-md:w-full max-md:border-r-0 max-md:border-b'>
        <Toolbar className='text-2xs text-fg-2'>
          {formatCount(diff.files.length, 'file', 'files')}
          <LineCounts added={totals.added} removed={totals.removed} />
        </Toolbar>
        <div className='min-h-0 flex-1 overflow-y-auto p-1.5'>
          {groups.map((group) => (
            <div key={group.directory || '/'} className='mb-1.5 flex flex-col'>
              {group.directory && (
                <Truncate className='px-2 py-1 text-2xs text-fg-2'>{group.directory}/</Truncate>
              )}
              {group.files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  selected={file.path === selected?.path}
                  comments={draft.comments.filter((comment) => comment.path === file.path).length}
                  onSelect={() => setPicked({ linkedPath, path: file.path })}
                />
              ))}
            </div>
          ))}
        </div>
      </aside>
      {selected && (
        <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
          <Toolbar>
            <FilePath path={selected.path} />
            {selected.previousPath && (
              <Truncate className='text-2xs text-fg-2'>renamed from {selected.previousPath}</Truncate>
            )}
            {selected.riskReason && (
              <span className='shrink-0 text-2xs text-red-text'>{selected.riskReason}</span>
            )}
            <div className='flex-1' />
            {task.worktreePath && (
              <Button
                variant='secondary'
                size='sm'
                icon='IconCode'
                onClick={() => void openWorktree(task.id, 'editor', selected.path)}
              >
                Open
              </Button>
            )}
          </Toolbar>
          <CodeView
            key={selected.path}
            taskId={task.id}
            file={selected}
            revision={task.updatedAt}
            mode='file'
            markers={listFindingMarkers(task, selected.path)}
          />
        </section>
      )}
    </div>
  );
}
