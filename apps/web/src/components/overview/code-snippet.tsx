import type { CodeSpot, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CollapseToggle } from '@/components/layout/surface/panel.tsx';
import { TokenText } from '@/components/text/code-fence.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { useTokens } from '@/lib/code/highlight.ts';
import { useFileContent, useTaskRefs } from '@/lib/connection/code.ts';
import { formatLineRange } from '@/lib/format/count.ts';
import { resolveSnippet } from '@/lib/overview/snippet.ts';

function SnippetBody({ task, spot }: { task: Task; spot: CodeSpot }) {
  const refs = useTaskRefs(task);
  const loaded = useFileContent(task, refs.status === 'ready' ? refs.value.head : null, spot.file);
  const content = loaded.status === 'ready' ? loaded.value.content : null;
  const tokens = useTokens(content, spot.file);
  if (content === null) {
    const waiting = refs.status === 'loading' || loaded.status === 'loading' || loaded.status === 'idle';
    return (
      <p className='px-2 py-1.5 text-2xs text-fg-2'>
        {waiting && refs.status !== 'error' ? 'Loading…' : 'This file is not at the head of the branch.'}
      </p>
    );
  }
  return (
    <pre className='overflow-x-auto py-1.5 font-mono text-2xs leading-5'>
      {resolveSnippet(content, spot).map((line) => (
        <div key={line.number} className={cn('flex', line.inRange && 'bg-primary-a1')}>
          <span className='w-10 shrink-0 select-none pe-3 text-right text-fg-2 tabular-nums'>
            {line.number}
          </span>
          <code className={cn('pe-3', line.inRange ? 'text-fg-4' : 'text-fg-2')}>
            <TokenText text={line.text || ' '} tokens={tokens?.[line.number - 1]} />
          </code>
        </div>
      ))}
    </pre>
  );
}

export function CodeSnippet({ task, spot }: { task: Task; spot: CodeSpot }) {
  const [open, setOpen] = React.useState(false);
  return (
    <figure className='corner-superellipse/1.125 flex flex-col overflow-hidden rounded-lg border border-border'>
      <figcaption className='flex h-7 items-center gap-1.5 border-border border-b bg-bg-a1 px-2 text-2xs'>
        <Icon size='sm' name='IconFileText' />
        <Truncate className='text-fg-3'>{spot.file}</Truncate>
        <span className='shrink-0 text-fg-2'>{formatLineRange(spot.start, spot.end)}</span>
        <span className='flex-1' />
        <CollapseToggle open={open} onToggle={() => setOpen(!open)} label='code' />
      </figcaption>
      {open && <SnippetBody task={task} spot={spot} />}
      <Markdown
        text={spot.why}
        className={cn('px-2 py-1.5 text-fg-3 text-xs', open && 'border-border border-t')}
      />
    </figure>
  );
}
