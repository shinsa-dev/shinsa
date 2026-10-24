import type { Task, TaskDiff, TaskRefs, WorkReport } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import { Spinner } from '@shinsa/ui/components/spinner';
import type * as React from 'react';
import { ChangesTree } from '@/components/code/changes-tree.tsx';
import { FileTree } from '@/components/code/file-tree.tsx';
import { ReviewExplorer } from '@/components/code/review.tsx';
import { SearchPanel } from '@/components/code/search-panel.tsx';
import { Choice } from '@/components/controls/choice.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import type { CodeLocation, CodeMode } from '@/lib/code/location.ts';
import { listRefChoices } from '@/lib/code/refs.ts';
import type { CodeSearch, Loaded } from '@/lib/connection/code.ts';
import type { ReviewOrder, ReviewTarget } from '@/lib/review/targets.ts';
import { CODE_MODE, type ExplorerMode } from '@/lib/tasks/tabs.ts';

export interface ExplorerProps {
  task: Task;
  refs: TaskRefs;
  gitRef: string;
  modes: ExplorerMode[];
  location: CodeLocation;
  diff: Loaded<TaskDiff>;
  report: WorkReport | null;
  findings: ReviewTarget[];
  commentCounts: ReadonlyMap<string, number>;
  viewed: ReadonlySet<string>;
  searchInput: React.Ref<HTMLInputElement>;
  onMode: (mode: CodeMode) => void;
  onRef: (ref: string) => void;
  onOrder: (order: ReviewOrder) => void;
  onTarget: (target: ReviewTarget) => void;
  onLine: (path: string, line: number, side: 'old' | 'new') => void;
  onChange: (path: string, pin: boolean) => void;
  onFile: (path: string, pin: boolean) => void;
  onMatch: (path: string, line: number) => void;
  onSearch: (search: CodeSearch) => void;
  onToggleViewed: (path: string) => void;
}

function Reading({ label }: { label: string }) {
  return (
    <div className='flex items-center gap-2 px-3 py-2.5 text-2xs text-fg-2'>
      <Spinner size='sm' /> {label}
    </div>
  );
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
      />
    );
  }
  if (diff.status === 'error') return <p className='px-3 py-2.5 text-2xs text-fg-2'>{diff.message}</p>;
  if (diff.status !== 'ready') return <Reading label='Reading the changes' />;
  if (location.mode === 'changes') {
    return (
      <ChangesTree
        diff={diff.value}
        activePath={location.active?.kind === 'diff' ? activePath : null}
        commentCounts={props.commentCounts}
        viewed={props.viewed}
        onToggleViewed={props.onToggleViewed}
        onOpen={props.onChange}
      />
    );
  }
  if (!props.report) return <Reading label='Reading the report' />;
  return (
    <ReviewExplorer
      task={props.task}
      report={props.report}
      findings={props.findings}
      order={location.order}
      selectedKey={location.spot}
      onOrder={props.onOrder}
      onSelect={props.onTarget}
      onSelectLine={props.onLine}
    />
  );
}

export function Explorer(props: ExplorerProps) {
  const { location, modes, refs } = props;
  const searching = location.mode === 'search';
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 flex-col gap-1.5 border-border border-b p-1.5'>
        <div className='flex items-center gap-1.5'>
          {modes.length > 1 ? (
            <Choice
              label='Code view'
              items={modes.map((mode) => ({ value: mode, label: CODE_MODE[mode].label }))}
              value={searching ? ('' as ExplorerMode) : (location.mode as ExplorerMode)}
              onValueChange={props.onMode}
              className='min-w-0 flex-1'
            />
          ) : (
            <span className='flex-1 px-1.5 font-medium text-fg-4 text-xs'>
              {CODE_MODE[modes[0] ?? 'files'].label}
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
          onValueChange={props.onRef}
          size='sm'
          align='start'
          className='w-full'
        />
      </div>
      <ScrollArea className='min-h-0 flex-1'>
        <ExplorerBody {...props} />
      </ScrollArea>
    </div>
  );
}
