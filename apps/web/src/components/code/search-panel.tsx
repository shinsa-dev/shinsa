import type { Task } from '@shinsa/core';
import { Input } from '@shinsa/ui/components/input';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { SearchField } from '@/components/code/search-field.tsx';
import { TREE_LIST, TreeRow } from '@/components/code/tree-row.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';
import type { CodeLocation } from '@/lib/code/location.ts';
import { describeSearchResult, groupMatches, listKeyedParts, splitMatchText } from '@/lib/code/search.ts';
import { type CodeSearch, useRepoSearch } from '@/lib/connection/code.ts';

const SEARCH_DELAY_MS = 250;

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
    wholeWord: location.wholeWord,
    glob: location.glob,
  });
  const delayed = useDelayedSearch(draft);
  const latest = React.useRef(onChange);
  latest.current = onChange;
  React.useEffect(() => latest.current(delayed), [delayed]);
  const loaded = useRepoSearch(task, gitRef, delayed);
  const groups = loaded.status === 'ready' ? groupMatches(loaded.value.matches) : [];
  const [folded, setFolded] = React.useState<ReadonlySet<string>>(new Set());
  const update = (patch: Partial<CodeSearch>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <div className='flex min-h-0 flex-col'>
      <div className='flex flex-col gap-1 px-1.5 pt-1.5'>
        <SearchField
          value={draft.query}
          options={draft}
          placeholder='Search in files'
          inputRef={inputRef}
          onValueChange={(query) => update({ query })}
          onOptionsChange={update}
        />
        <Input
          value={draft.glob}
          placeholder='Files to include, such as src/**/*.ts'
          aria-label='Files to include'
          onChange={(event) => update({ glob: event.target.value })}
        />
      </div>
      {loaded.status === 'loading' && (
        <div className='flex items-center gap-2 px-2.5 py-1.5 text-2xs text-fg-2'>
          <Spinner size='sm' /> Searching
        </div>
      )}
      {loaded.status === 'error' && <p className='px-2.5 py-1.5 text-2xs text-red-text'>{loaded.message}</p>}
      {loaded.status === 'ready' && (
        <p aria-live='polite' className='px-2.5 pt-1.5 text-2xs text-fg-2'>
          {describeSearchResult(loaded.value)}
        </p>
      )}
      <div role='tree' aria-label='Search results' className={TREE_LIST}>
        {groups.map((group) => (
          <React.Fragment key={group.path}>
            <TreeRow
              depth={0}
              expanded={!folded.has(group.path)}
              icon={resolveFileIcon(group.path)}
              label={group.path}
              end={<span className='shrink-0 text-2xs text-fg-2 tabular-nums'>{group.matches.length}</span>}
              onOpen={() =>
                setFolded((current) => {
                  const next = new Set(current);
                  if (next.has(group.path)) next.delete(group.path);
                  else next.add(group.path);
                  return next;
                })
              }
            >
              <FilePath path={group.path} className='flex-1' />
            </TreeRow>
            {!folded.has(group.path) &&
              group.matches.map((match) => (
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
