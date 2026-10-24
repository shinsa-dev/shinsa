import type { Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { TreeRow } from '@/components/code/tree-row.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import type { CodeLocation } from '@/lib/code/location.ts';
import { describeSearchResult, groupMatches, listKeyedParts, splitMatchText } from '@/lib/code/search.ts';
import { type CodeSearch, useRepoSearch } from '@/lib/connection/code.ts';

const SEARCH_DELAY_MS = 250;

function Toggle({
  label,
  pressed,
  onToggle,
  children,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label}>
      <Button
        variant='secondary'
        size='icon-sm'
        aria-label={label}
        aria-pressed={pressed}
        onClick={onToggle}
        className={cn('font-mono', pressed && 'bg-bg-a3 text-fg-4')}
      >
        {children}
      </Button>
    </Hint>
  );
}

function useDelayedSearch(search: CodeSearch) {
  const [delayed, setDelayed] = React.useState(search);
  const key = JSON.stringify(search);
  React.useEffect(() => {
    const timer = setTimeout(() => setDelayed(JSON.parse(key) as CodeSearch), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return delayed;
}

export function SearchPanel({
  task,
  gitRef,
  location,
  inputRef,
  onChange,
  onOpen,
}: {
  task: Task;
  gitRef: string;
  location: CodeLocation;
  inputRef: React.Ref<HTMLInputElement>;
  onChange: (search: CodeSearch) => void;
  onOpen: (path: string, line: number) => void;
}) {
  const [draft, setDraft] = React.useState<CodeSearch>({
    query: location.query,
    regex: location.regex,
    caseSensitive: location.caseSensitive,
    glob: location.glob,
  });
  const delayed = useDelayedSearch(draft);
  const latest = React.useRef(onChange);
  latest.current = onChange;
  React.useEffect(() => latest.current(delayed), [delayed]);
  const loaded = useRepoSearch(task, gitRef, delayed);
  const groups = loaded.status === 'ready' ? groupMatches(loaded.value.matches) : [];
  const update = (patch: Partial<CodeSearch>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <div className='flex min-h-0 flex-col gap-1.5 p-1.5'>
      <div className='flex items-center gap-1'>
        <Input
          ref={inputRef}
          size='sm'
          value={draft.query}
          placeholder='Search in files'
          aria-label='Search in files'
          onChange={(event) => update({ query: event.target.value })}
        />
        <Toggle
          label='Match case'
          pressed={draft.caseSensitive}
          onToggle={() => update({ caseSensitive: !draft.caseSensitive })}
        >
          Aa
        </Toggle>
        <Toggle
          label='Use a regular expression'
          pressed={draft.regex}
          onToggle={() => update({ regex: !draft.regex })}
        >
          .*
        </Toggle>
      </div>
      <Input
        size='sm'
        value={draft.glob}
        placeholder='Files to include, such as src/**/*.ts'
        aria-label='Files to include'
        onChange={(event) => update({ glob: event.target.value })}
      />
      {loaded.status === 'loading' && (
        <div className='flex items-center gap-2 px-1.5 py-1 text-2xs text-fg-2'>
          <Spinner size='sm' /> Searching
        </div>
      )}
      {loaded.status === 'error' && <p className='px-1.5 py-1 text-2xs text-red-text'>{loaded.message}</p>}
      {loaded.status === 'ready' && (
        <p aria-live='polite' className='px-1.5 py-1 text-2xs text-fg-2'>
          {describeSearchResult(loaded.value)}
        </p>
      )}
      <div role='tree' aria-label='Search results' className='flex flex-col'>
        {groups.map((group) => (
          <React.Fragment key={group.path}>
            <div className='flex h-6 items-center gap-1.5 px-1.5'>
              <FilePath path={group.path} className='flex-1' />
              <span className='shrink-0 text-2xs text-fg-2 tabular-nums'>{group.matches.length}</span>
            </div>
            {group.matches.map((match) => (
              <TreeRow
                key={`${match.path}:${match.line}:${match.column}`}
                depth={1}
                label={`${match.path} line ${match.line}`}
                end={<span className='shrink-0 text-2xs text-fg-2 tabular-nums'>{match.line}</span>}
                onOpen={() => onOpen(match.path, match.line)}
              >
                <Truncate className='flex-1 font-mono'>
                  {listKeyedParts(splitMatchText(match.text.trim(), delayed.query, delayed)).map((part) =>
                    part.hit ? (
                      <mark key={part.key} className='rounded-xs bg-amber-a2 text-fg-4'>
                        {part.text}
                      </mark>
                    ) : (
                      <React.Fragment key={part.key}>{part.text}</React.Fragment>
                    )
                  )}
                </Truncate>
              </TreeRow>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
