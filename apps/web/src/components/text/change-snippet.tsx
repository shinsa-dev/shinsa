import type { Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CollapseToggle } from '@/components/layout/surface/panel.tsx';
import { InAppLink } from '@/components/links/link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { CodeDiff } from '@/components/text/code-diff.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { type DiffLines, resolveSpotSource } from '@/lib/code/diff-view.ts';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';
import { useFileContent, useFileDiff, useTaskRefs } from '@/lib/connection/code.ts';
import { formatLineRange } from '@/lib/format/count.ts';
import { resolveCodePath } from '@/lib/review/places.ts';

const NOTE = 'px-2 py-1.5 text-2xs text-fg-2';

function SnippetBody({ task, path, lines }: { task: Task; path: string; lines: DiffLines }) {
  const refs = useTaskRefs(task);
  const ready = refs.status === 'ready' ? refs.value : null;
  const diff = useFileDiff(task, ready?.base ?? null, ready?.base ? ready.head : null, path);
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

const PLACE_UNDERLINE =
  'underline decoration-transparent underline-offset-3 transition-colors duration-150 group-hover/link:decoration-fg-a3 group-active/link:decoration-fg-a3';

function SnippetPlace({
  task,
  path,
  start,
  end,
  spot,
}: {
  task: Task;
  path: string;
  start: number;
  end: number;
  spot: string | null;
}) {
  const linked = Boolean(task.repoId);
  const place = (
    <>
      <Icon size='sm' name={resolveFileIcon(path)} />
      <Truncate className={cn('text-fg-3', linked && PLACE_UNDERLINE)}>{path}</Truncate>
      <span className='shrink-0 text-fg-2'>{formatLineRange(start, end)}</span>
    </>
  );
  if (!linked) return <span className='flex min-w-0 items-center gap-1.5'>{place}</span>;
  return (
    <Hint label='Open in Code'>
      <InAppLink
        path={resolveCodePath(task, { file: path, start, end }, spot)}
        className='group/link flex min-w-0 cursor-pointer items-center gap-1.5 no-underline outline-none'
      >
        {place}
      </InAppLink>
    </Hint>
  );
}

export function ChangeSnippet({
  task,
  path,
  start,
  end,
  why = null,
  startsOpen = false,
  label = null,
  spot = null,
}: {
  task: Task;
  path: string;
  start: number;
  end: number;
  why?: string | null;
  startsOpen?: boolean;
  label?: React.ReactNode;
  spot?: string | null;
}) {
  const [open, setOpen] = React.useState(startsOpen);
  const lines = React.useMemo(() => ({ start, end }), [start, end]);
  return (
    <figure className='corner-superellipse/1.125 flex min-w-0 flex-col overflow-hidden rounded-lg border border-border'>
      <figcaption className='flex h-7 items-center gap-1.5 bg-bg-a1 px-2 text-2xs'>
        {label}
        <SnippetPlace task={task} path={path} start={start} end={end} spot={spot} />
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
