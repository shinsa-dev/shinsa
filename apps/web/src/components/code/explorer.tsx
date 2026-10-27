import type { Task, TaskDiff, TaskRefs } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ChangesTree } from '@/components/code/changes-tree.tsx';
import { CodeLoading } from '@/components/code/code-loading.tsx';
import { FileTree } from '@/components/code/file-tree.tsx';
import { SearchPanel } from '@/components/code/search-panel.tsx';
import { TREE_HOVER_GROUP } from '@/components/code/tree-row.tsx';
import { Choice } from '@/components/controls/choice.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import type { CodeFileRef, CodeLocation, CodeMode } from '@/lib/code/location.ts';
import { listRefChoices } from '@/lib/code/refs.ts';
import type { CodeSearch, Loaded } from '@/lib/connection/code.ts';
import { resolveTaskDisclosureId } from '@/lib/preferences/disclosure.ts';
import { CODE_MODE, type ExplorerMode } from '@/lib/tasks/tabs.ts';

export interface ExplorerProps {
  task: Task;
  refs: TaskRefs;
  gitRef: string;
  modes: ExplorerMode[];
  location: CodeLocation;
  diff: Loaded<TaskDiff>;
  commentCounts: ReadonlyMap<string, number>;
  viewed: ReadonlySet<string>;
  searchInput: React.Ref<HTMLInputElement>;
  onMode: (mode: CodeMode) => void;
  onRef: (ref: string) => void;
  onChange: (path: string) => void;
  onFile: (path: string) => void;
  onMatch: (path: string, line: number) => void;
  onSearch: (search: CodeSearch) => void;
  onToggleViewed: (path: string) => void;
  onPrefetch: (file: CodeFileRef) => void;
  onPrefetchPath: (path: string) => void;
  onPrefetchFolder: (dir: string) => void;
  onFloor?: (width: number) => void;
}

function resolveWaiting({ location, diff }: ExplorerProps) {
  if (location.mode === 'search' || location.mode === 'files' || diff.status === 'error') return null;
  if (diff.status !== 'ready') return 'Reading the changes…';
  return null;
}

function ExplorerBody(props: ExplorerProps) {
  const { location, diff } = props;
  const activePath = location.active?.path ?? null;
  if (location.mode === 'search') {
    return (
      <SearchPanel
        task={props.task}
        gitRef={props.gitRef}
        location={location}
        inputRef={props.searchInput}
        onChange={props.onSearch}
        onOpen={props.onMatch}
        onPrefetch={props.onPrefetchPath}
      />
    );
  }
  if (location.mode === 'files') {
    return (
      <FileTree
        task={props.task}
        gitRef={props.gitRef}
        activePath={activePath}
        changes={diff.status === 'ready' ? diff.value.files : []}
        onOpen={props.onFile}
        onPrefetch={(path) => props.onPrefetch({ kind: 'file', path })}
        onPrefetchFolder={props.onPrefetchFolder}
      />
    );
  }
  if (diff.status === 'error') return <p className='px-3 py-2.5 text-2xs text-fg-2'>{diff.message}</p>;
  if (diff.status !== 'ready') return null;
  return (
    <ChangesTree
      persistId={resolveTaskDisclosureId(props.task.id, 'code', 'changes')}
      diff={diff.value}
      activePath={location.active?.kind === 'diff' ? activePath : null}
      commentCounts={props.commentCounts}
      viewed={props.viewed}
      onToggleViewed={props.onToggleViewed}
      onOpen={props.onChange}
      onPrefetch={(path) => props.onPrefetch({ kind: 'diff', path })}
    />
  );
}

function measureNatural(element: Element) {
  return (element.querySelector('[role="tablist"], [data-natural]') ?? element).getBoundingClientRect().width;
}

function useHeaderFloor(onFloor: ((width: number) => void) | undefined) {
  const row = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const element = row.current;
    const frame = element?.closest('aside');
    if (!element || !frame || !onFloor) return;
    const measure = () => {
      const parts = [...element.children].map(measureNatural);
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      const edges = frame.offsetWidth - element.clientWidth;
      onFloor(parts.reduce((sum, width) => sum + width, 0) + gap * (parts.length - 1) + edges);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const child of element.children)
      observer.observe(child.querySelector('[role="tablist"], [data-natural]') ?? child);
    return () => observer.disconnect();
  }, [onFloor]);
  return row;
}

export function Explorer(props: ExplorerProps) {
  const { location, modes, refs } = props;
  const searching = location.mode === 'search';
  const waiting = resolveWaiting(props);
  const row = useHeaderFloor(props.onFloor);
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', TREE_HOVER_GROUP)}>
      <div className='flex shrink-0 flex-col gap-1.5 border-border border-b p-1.5'>
        <div ref={row} className='flex items-center gap-1.5'>
          {modes.length > 1 ? (
            <Choice
              label='Code view'
              items={modes.map((mode) => ({ value: mode, label: CODE_MODE[mode].label }))}
              value={searching ? ('' as ExplorerMode) : (location.mode as ExplorerMode)}
              onValueChange={props.onMode}
              className='min-w-max flex-1'
            />
          ) : (
            <span className='flex min-w-max flex-1'>
              <span data-natural className='px-1.5 font-medium text-fg-4 text-xs'>
                {CODE_MODE[modes[0] ?? 'files'].label}
              </span>
            </span>
          )}
          <Hint label='Search in files' shortcut='⇧⌘F'>
            <Button
              variant='secondary'
              size='icon-sm'
              icon='IconMagnifyingGlass'
              aria-label='Search in files'
              aria-pressed={searching}
              className={searching ? 'bg-bg-a3 text-fg-4' : undefined}
              onClick={() => props.onMode(searching ? (modes[0] ?? 'files') : 'search')}
            />
          </Hint>
        </div>
        <SelectField
          label='Show the code at'
          items={listRefChoices(refs)}
          value={props.gitRef}
          onValueChange={(value) => setTimeout(() => props.onRef(value), 0)}
          size='sm'
          align='start'
          className='w-full'
        />
      </div>
      {waiting ? (
        <CodeLoading label={waiting} />
      ) : (
        <ScrollArea className='min-h-0 flex-1'>
          <ExplorerBody {...props} />
        </ScrollArea>
      )}
    </div>
  );
}
