import type { DiffFile, RepoEntry, Task } from '@shinsa/core';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { StatusLetter } from '@/components/code/changes-tree.tsx';
import { TREE_LIST, TreeRow } from '@/components/code/tree-row.tsx';
import { resolveFileIcon, resolveFolderIcon } from '@/lib/code/file-icons.ts';
import { type ActiveGuide, listAncestors, pickGuideLevel, resolveActiveGuide } from '@/lib/code/tree.ts';
import { useRepoTree } from '@/lib/connection/code.ts';

interface FileTreeContext {
  task: Task;
  gitRef: string;
  activePath: string | null;
  guide: ActiveGuide | null;
  changed: ReadonlyMap<string, DiffFile>;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}

function EntryRow({ entry, depth, context }: { entry: RepoEntry; depth: number; context: FileTreeContext }) {
  if (entry.kind === 'directory') {
    const open = context.expanded.has(entry.path);
    return (
      <>
        <TreeRow
          depth={depth}
          guide={pickGuideLevel(context.guide, entry.path)}
          expanded={open}
          icon={resolveFolderIcon(entry.path, open)}
          label={entry.path}
          onOpen={() => context.onToggle(entry.path)}
        >
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
      guide={pickGuideLevel(context.guide, entry.path)}
      selected={entry.path === context.activePath}
      label={entry.path}
      icon={entry.kind === 'submodule' ? 'IconFolders' : resolveFileIcon(entry.path)}
      end={change && <StatusLetter status={change.status} />}
      onOpen={() => context.onOpen(entry.path)}
    >
      <Truncate className='flex-1'>{entry.name}</Truncate>
    </TreeRow>
  );
}

function Folder({ dir, depth, context }: { dir: string; depth: number; context: FileTreeContext }) {
  const loaded = useRepoTree(context.task, context.gitRef, dir);
  if (loaded.status === 'error') {
    return (
      <p className='py-1 text-2xs text-fg-2' style={{ paddingInlineStart: 24 + depth * 8 }}>
        {loaded.message}
      </p>
    );
  }
  if (loaded.status !== 'ready') {
    return (
      <div className='flex h-5.5 items-center' style={{ paddingInlineStart: 22 + depth * 8 }}>
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
  onOpen: (path: string) => void;
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
    guide: resolveActiveGuide(activePath),
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
    <div role='tree' aria-label='Files' className={TREE_LIST}>
      <Folder dir='' depth={0} context={context} />
    </div>
  );
}
