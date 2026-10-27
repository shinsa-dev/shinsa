import type { DiffFile, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { flushSync } from 'react-dom';
import { StatusLetter } from '@/components/code/changes-tree.tsx';
import { CodeLoading } from '@/components/code/code-loading.tsx';
import { TREE_LIST, TREE_ROW_HEIGHT, TreeRow } from '@/components/code/tree-row.tsx';
import { VirtualRows } from '@/components/settings/virtual-rows.tsx';
import { resolveFileIcon, resolveFolderIcon } from '@/lib/code/file-icons.ts';
import { CODE_MARKS, markCode, measureCode } from '@/lib/code/marks.ts';
import { scheduleIdle } from '@/lib/code/prefetch.ts';
import {
  isTreeSettled,
  listAncestors,
  listNeighbourPaths,
  listOpenFolders,
  listRepoRows,
  pickGuideLevel,
  type RepoRow,
  resolveActiveGuide,
} from '@/lib/code/tree.ts';
import { requestRepoTree, useRepoTrees } from '@/lib/connection/code.ts';
import { resolveTaskDisclosureId, useDisclosureSet } from '@/lib/preferences/disclosure.ts';

const FOLDER_PREFETCH_LIMIT = 64;

function resolveRowKey(row: RepoRow) {
  return row.kind === 'entry' ? `e:${row.entry.path}` : `${row.kind}:${row.dir}`;
}

export function FileTree({
  task,
  gitRef,
  activePath,
  changes,
  onOpen,
  onPrefetch,
  onPrefetchFolder,
}: {
  task: Task;
  gitRef: string;
  activePath: string | null;
  changes: readonly DiffFile[];
  onOpen: (path: string) => void;
  onPrefetch: (path: string) => void;
  onPrefetchFolder: (dir: string) => void;
}) {
  const [stored, markOpen] = useDisclosureSet(resolveTaskDisclosureId(task.id, 'code', 'files'), true);
  const [revealed, replaceRevealed] = React.useState<string | null>(null);
  const expanded = React.useMemo<ReadonlySet<string>>(
    () => (revealed === activePath ? stored : new Set([...stored, ...listAncestors(activePath ?? '')])),
    [stored, revealed, activePath]
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
  const files = settled.current?.rows.flatMap((row) =>
    row.kind === 'entry' && row.entry.kind === 'file' ? [row.entry.path] : []
  );
  const neighbours = listNeighbourPaths(files ?? [], activePath).join('\n');
  const latestPrefetch = React.useRef(onPrefetch);
  latestPrefetch.current = onPrefetch;
  React.useEffect(
    () =>
      scheduleIdle(() => {
        for (const path of neighbours.split('\n')) if (path) latestPrefetch.current(path);
      }),
    [neighbours]
  );
  const closedFolders = (settled.current?.rows ?? [])
    .flatMap((row) =>
      row.kind === 'entry' && row.entry.kind === 'directory' && !row.open ? [row.entry.path] : []
    )
    .slice(0, FOLDER_PREFETCH_LIMIT)
    .join('\n');
  const latestFolderPrefetch = React.useRef(onPrefetchFolder);
  latestFolderPrefetch.current = onPrefetchFolder;
  React.useEffect(
    () =>
      scheduleIdle(() => {
        for (const dir of closedFolders.split('\n')) if (dir) latestFolderPrefetch.current(dir);
      }),
    [closedFolders]
  );
  const toggled = React.useRef<string | null>(null);
  const shownRows = settled.current?.rows;
  React.useLayoutEffect(() => {
    if (toggled.current) measureCode(CODE_MARKS.toggled, toggled.current);
    toggled.current = null;
  }, [shownRows]);
  if (!settled.current) return <CodeLoading label='Reading the files…' />;
  const { ref: shownRef, rows } = settled.current;
  const toggle = (path: string) => {
    markCode(CODE_MARKS.toggle, path);
    toggled.current = path;
    const flip = () =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    if (expanded.has(path)) {
      flip();
      return;
    }
    const show = () => flushSync(flip);
    requestRepoTree(task, gitRef, path).then(show, show);
  };
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
                onPrefetch={() => onPrefetchFolder(entry.path)}
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
              onPrefetch={() => onPrefetch(entry.path)}
            >
              <Truncate className='flex-1'>{entry.name}</Truncate>
            </TreeRow>
          );
        }}
      </VirtualRows>
    </div>
  );
}
