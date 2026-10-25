import type { DiffFile, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { StatusLetter } from '@/components/code/changes-tree.tsx';
import { CodeLoading } from '@/components/code/code-loading.tsx';
import { TREE_LIST, TREE_ROW_HEIGHT, TreeRow } from '@/components/code/tree-row.tsx';
import { VirtualRows } from '@/components/settings/virtual-rows.tsx';
import { resolveFileIcon, resolveFolderIcon } from '@/lib/code/file-icons.ts';
import {
  isTreeSettled,
  listAncestors,
  listOpenFolders,
  listRepoRows,
  pickGuideLevel,
  type RepoRow,
  resolveActiveGuide,
} from '@/lib/code/tree.ts';
import { useRepoTrees } from '@/lib/connection/code.ts';

function resolveRowKey(row: RepoRow) {
  return row.kind === 'entry' ? `e:${row.entry.path}` : `${row.kind}:${row.dir}`;
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
  const folders = useRepoTrees(task, gitRef, listOpenFolders(expanded));
  const listed = listRepoRows(folders, expanded);
  const settled = React.useRef<{ ref: string; rows: RepoRow[] } | null>(null);
  if (isTreeSettled(listed)) settled.current = { ref: gitRef, rows: listed };
  const guide = resolveActiveGuide(activePath);
  if (!settled.current) return <CodeLoading label='Reading the files…' />;
  const { ref: shownRef, rows } = settled.current;
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <div role='tree' aria-label='Files' className={TREE_LIST}>
      <VirtualRows key={shownRef} items={rows} rowHeight={TREE_ROW_HEIGHT} keyOf={resolveRowKey}>
        {(row) => {
          if (row.kind === 'loading') return null;
          if (row.kind === 'error') {
            return (
              <p
                className='truncate py-1 text-2xs text-fg-2'
                style={{ paddingInlineStart: 24 + row.depth * 8 }}
              >
                {row.message}
              </p>
            );
          }
          const { entry } = row;
          if (entry.kind === 'directory') {
            return (
              <TreeRow
                depth={row.depth}
                guide={pickGuideLevel(guide, entry.path)}
                expanded={row.open}
                icon={resolveFolderIcon(entry.path, row.open)}
                label={entry.path}
                onOpen={() => toggle(entry.path)}
              >
                <Truncate className='flex-1'>{entry.name}</Truncate>
              </TreeRow>
            );
          }
          const change = changed.get(entry.path);
          return (
            <TreeRow
              depth={row.depth}
              guide={pickGuideLevel(guide, entry.path)}
              selected={entry.path === activePath}
              label={entry.path}
              icon={entry.kind === 'submodule' ? 'IconFolders' : resolveFileIcon(entry.path)}
              end={change && <StatusLetter status={change.status} />}
              onOpen={() => onOpen(entry.path)}
            >
              <Truncate className='flex-1'>{entry.name}</Truncate>
            </TreeRow>
          );
        }}
      </VirtualRows>
    </div>
  );
}
