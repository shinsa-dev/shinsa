import type { DiffFile, RepoEntry, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { StatusLetter } from '@/components/code/changes-tree.tsx';
import { TreeRow } from '@/components/code/tree-row.tsx';
import { listAncestors } from '@/lib/code/tree.ts';
import { useRepoTree } from '@/lib/connection/code.ts';

interface FileTreeContext {
  task: Task;
  gitRef: string;
  activePath: string | null;
  changed: ReadonlyMap<string, DiffFile>;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string, pin: boolean) => void;
}

function EntryRow({ entry, depth, context }: { entry: RepoEntry; depth: number; context: FileTreeContext }) {
  if (entry.kind === 'directory') {
    const open = context.expanded.has(entry.path);
    return (
      <>
        <TreeRow depth={depth} expanded={open} label={entry.path} onOpen={() => context.onToggle(entry.path)}>
          <Truncate className='flex-1'>{entry.name}</Truncate>
        </TreeRow>
        {open && <Folder dir={entry.path} depth={depth + 1} context={context} />}
      </>
    );
  }
  const change = context.changed.get(entry.path);
  return (
    <TreeRow
      depth={depth}
      selected={entry.path === context.activePath}
      label={entry.path}
      lead={
        change ? (
          <StatusLetter status={change.status} />
        ) : (
          <Icon size='sm' name={entry.kind === 'submodule' ? 'IconFolder1' : 'IconFileText'} />
        )
      }
      onOpen={() => context.onOpen(entry.path, false)}
      onPin={() => context.onOpen(entry.path, true)}
    >
      <Truncate className='flex-1'>{entry.name}</Truncate>
    </TreeRow>
  );
}

function Folder({ dir, depth, context }: { dir: string; depth: number; context: FileTreeContext }) {
  const loaded = useRepoTree(context.task, context.gitRef, dir);
  if (loaded.status === 'error') {
    return (
      <p className='py-1 text-2xs text-fg-2' style={{ paddingInlineStart: 26 + depth * 12 }}>
        {loaded.message}
      </p>
    );
  }
  if (loaded.status !== 'ready') {
    return (
      <div className='flex h-6 items-center' style={{ paddingInlineStart: 6 + depth * 12 }}>
        <Spinner size='sm' />
      </div>
    );
  }
  return loaded.value.entries.map((entry) => (
    <EntryRow key={entry.path} entry={entry} depth={depth} context={context} />
  ));
}

export function FileTree({
  task,
  gitRef,
  activePath,
  changes,
  onOpen,
}: {
  task: Task;
  gitRef: string;
  activePath: string | null;
  changes: readonly DiffFile[];
  onOpen: (path: string, pin: boolean) => void;
}) {
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(listAncestors(activePath ?? ''))
  );
  const changed = React.useMemo(() => new Map(changes.map((file) => [file.path, file])), [changes]);
  React.useEffect(() => {
    if (!activePath) return;
    setExpanded((current) => {
      const missing = listAncestors(activePath).filter((dir) => !current.has(dir));
      return missing.length === 0 ? current : new Set([...current, ...missing]);
    });
  }, [activePath]);
  const context: FileTreeContext = {
    task,
    gitRef,
    activePath,
    changed,
    expanded,
    onOpen,
    onToggle: (path) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
  };
  return (
    <div role='tree' aria-label='Files' className='flex flex-col p-1.5'>
      <Folder dir='' depth={0} context={context} />
    </div>
  );
}
