import type { Task } from '@shinsa/core';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shinsa/ui/components/command';
import * as React from 'react';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';
import { scheduleIdle } from '@/lib/code/prefetch.ts';
import { rankPaths, splitHits } from '@/lib/code/rank.ts';
import { listKeyedParts } from '@/lib/code/search.ts';
import { resolveDirectory, resolveFileName } from '@/lib/code/tree.ts';
import { type Loaded, useRepoPaths } from '@/lib/connection/code.ts';

const QUICK_OPEN_LIMIT = 50;

function HitText({ text, hits, offset }: { text: string; hits: readonly number[]; offset: number }) {
  return listKeyedParts(splitHits(text, hits, offset)).map((part) =>
    part.hit ? (
      <span key={part.key} className='text-primary-text'>
        {part.text}
      </span>
    ) : (
      <React.Fragment key={part.key}>{part.text}</React.Fragment>
    )
  );
}

export function QuickOpenDialog({
  loaded,
  open,
  recent,
  onOpenChange,
  onPick,
  onPrefetch,
}: {
  loaded: Loaded<{ paths: readonly string[] }>;
  open: boolean;
  recent: readonly string[];
  onOpenChange: (open: boolean) => void;
  onPick: (path: string) => void;
  onPrefetch?: (path: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const paths = loaded.status === 'ready' ? loaded.value.paths : null;
  const recentKey = recent.join('\n');
  const ranked = React.useMemo(
    () =>
      open && paths ? rankPaths(paths, query, QUICK_OPEN_LIMIT, recentKey ? recentKey.split('\n') : []) : [],
    [open, paths, query, recentKey]
  );
  const first = ranked[0]?.path ?? null;
  const latestPrefetch = React.useRef(onPrefetch);
  latestPrefetch.current = onPrefetch;
  React.useEffect(() => {
    if (!first) return;
    return scheduleIdle(() => latestPrefetch.current?.(first));
  }, [first]);
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
      title='Go to file'
      description='Open any file of the repository by its name.'
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder='Go to file'
          aria-label='Go to file'
        />
        <CommandList>
          {loaded.status === 'loading' && (
            <LoadingLine label='Reading the files' className='px-2 py-1.5 text-xs' />
          )}
          {loaded.status === 'error' && <p className='px-2 py-1.5 text-red-text text-xs'>{loaded.message}</p>}
          {loaded.status === 'ready' && <CommandEmpty>No file matches.</CommandEmpty>}
          {ranked.map((entry) => {
            const name = resolveFileName(entry.path);
            const directory = resolveDirectory(entry.path);
            return (
              <CommandItem
                key={entry.path}
                value={entry.path}
                icon={resolveFileIcon(entry.path)}
                onSelect={() => onPick(entry.path)}
              >
                <span className='shrink-0'>
                  <HitText text={name} hits={entry.hits} offset={entry.path.length - name.length} />
                </span>
                {directory && (
                  <CommandHint>
                    <HitText text={directory} hits={entry.hits} offset={0} />
                  </CommandHint>
                )}
              </CommandItem>
            );
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function QuickOpen({
  task,
  gitRef,
  open,
  recent,
  onOpenChange,
  onPick,
  onPrefetch,
}: {
  task: Task;
  gitRef: string;
  open: boolean;
  recent: readonly string[];
  onOpenChange: (open: boolean) => void;
  onPick: (path: string) => void;
  onPrefetch: (path: string) => void;
}) {
  const loaded = useRepoPaths(task, gitRef);
  return (
    <QuickOpenDialog
      loaded={loaded}
      open={open}
      recent={recent}
      onOpenChange={onOpenChange}
      onPick={onPick}
      onPrefetch={onPrefetch}
    />
  );
}
