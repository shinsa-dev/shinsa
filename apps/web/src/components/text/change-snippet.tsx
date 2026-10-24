import type { Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { CollapseToggle } from '@/components/layout/surface/panel.tsx';
import { CodeDiff } from '@/components/text/code-diff.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { type DiffLines, resolveSpotSource } from '@/lib/code/diff-view.ts';
import { useFileContent, useTaskDiff, useTaskRefs } from '@/lib/connection/code.ts';
import { formatLineRange } from '@/lib/format/count.ts';

const NOTE = 'px-2 py-1.5 text-2xs text-fg-2';

function SnippetBody({ task, path, lines }: { task: Task; path: string; lines: DiffLines }) {
  const refs = useTaskRefs(task);
  const ready = refs.status === 'ready' ? refs.value : null;
  const diff = useTaskDiff(task, ready?.base ?? null, ready?.base ? ready.head : null);
  const loaded = useFileContent(task, ready?.head ?? null, path);
  const file = diff.status === 'ready' ? (diff.value.files.find((item) => item.path === path) ?? null) : null;
  const content = loaded.status === 'ready' ? loaded.value.content : null;
  const source = React.useMemo(
    () => resolveSpotSource(path, file, content, lines),
    [path, file, content, lines]
  );
  if (source) return <CodeDiff source={source} numbered selected={lines} />;
  const waiting = [refs, diff, loaded].some((read) => read.status === 'loading');
  return <p className={NOTE}>{waiting ? 'Loading…' : 'This file is not at the head of the branch.'}</p>;
}

export function ChangeSnippet({
  task,
  path,
  start,
  end,
  why = null,
  startsOpen = false,
}: {
  task: Task;
  path: string;
  start: number;
  end: number;
  why?: string | null;
  startsOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(startsOpen);
  const lines = React.useMemo(() => ({ start, end }), [start, end]);
  return (
    <figure className='corner-superellipse/1.125 flex min-w-0 flex-col overflow-hidden rounded-lg border border-border'>
      <figcaption className='flex h-7 items-center gap-1.5 bg-bg-a1 px-2 text-2xs'>
        <Icon size='sm' name='IconFileText' />
        <Truncate className='text-fg-3'>{path}</Truncate>
        <span className='shrink-0 text-fg-2'>{formatLineRange(start, end)}</span>
        <span className='flex-1' />
        <CollapseToggle open={open} onToggle={() => setOpen(!open)} label='code' />
      </figcaption>
      {open && (
        <div className='border-border border-t'>
          <SnippetBody task={task} path={path} lines={lines} />
        </div>
      )}
      {why && <Markdown text={why} className='border-border border-t px-2 py-1.5 text-fg-3 text-xs' />}
    </figure>
  );
}
