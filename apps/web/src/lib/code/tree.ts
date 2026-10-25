import type { DiffFile, RepoEntry, RepoTree } from '@shinsa/core';
import type { Loaded } from '@/lib/connection/code.ts';

export interface TreeRow {
  kind: 'directory' | 'file';
  path: string;
  name: string;
  depth: number;
  file: DiffFile | null;
}

interface Folder {
  folders: Map<string, Folder>;
  files: DiffFile[];
}

function createFolder(): Folder {
  return { folders: new Map(), files: [] };
}

function buildFolders(files: DiffFile[]) {
  const root = createFolder();
  for (const file of files) {
    const parts = file.path.split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const next = folder.folders.get(part) ?? createFolder();
      folder.folders.set(part, next);
      folder = next;
    }
    folder.files.push(file);
  }
  return root;
}

function compact(name: string, folder: Folder): [string, Folder] {
  let label = name;
  let current = folder;
  while (current.files.length === 0 && current.folders.size === 1) {
    const [[child, next]] = [...current.folders] as [[string, Folder]];
    label = `${label}/${child}`;
    current = next;
  }
  return [label, current];
}

function listRows(folder: Folder, prefix: string, depth: number, collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const folders = [...folder.folders].sort(([a], [b]) => a.localeCompare(b));
  for (const [name, child] of folders) {
    const [label, inner] = compact(name, child);
    const path = `${prefix}${label}`;
    rows.push({ kind: 'directory', path, name: label, depth, file: null });
    if (!collapsed.has(path)) rows.push(...listRows(inner, `${path}/`, depth + 1, collapsed));
  }
  const files = [...folder.files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    rows.push({ kind: 'file', path: file.path, name: file.path.slice(prefix.length), depth, file });
  }
  return rows;
}

export function listChangeRows(files: DiffFile[], collapsed: ReadonlySet<string>): TreeRow[] {
  return listRows(buildFolders(files), '', 0, collapsed);
}

export interface ActiveGuide {
  dir: string;
  level: number;
}

export function findActiveGuide(rows: readonly TreeRow[], activePath: string | null): ActiveGuide | null {
  const index = rows.findIndex((each) => each.kind === 'file' && each.path === activePath);
  const open = rows[index];
  if (!open || open.depth === 0) return null;
  for (let at = index - 1; at >= 0; at -= 1) {
    const parent = rows[at];
    if (parent?.kind === 'directory' && parent.depth === open.depth - 1)
      return { dir: parent.path, level: parent.depth };
  }
  return null;
}

export function resolveActiveGuide(activePath: string | null): ActiveGuide | null {
  const dir = resolveDirectory(activePath ?? '');
  return dir ? { dir, level: dir.split('/').length - 1 } : null;
}

export function pickGuideLevel(guide: ActiveGuide | null, path: string) {
  return guide && path.startsWith(`${guide.dir}/`) ? guide.level : undefined;
}

export function listShownChanges(
  files: DiffFile[],
  viewed: ReadonlySet<string>,
  hideViewed: boolean,
  activePath: string | null
) {
  return hideViewed ? files.filter((file) => file.path === activePath || !viewed.has(file.path)) : files;
}

export function listNeighbourPaths(paths: readonly string[], active: string | null, before = 1, after = 2) {
  const index = active === null ? -1 : paths.indexOf(active);
  if (index < 0) return [];
  return [...paths.slice(index + 1, index + 1 + after), ...paths.slice(Math.max(0, index - before), index)];
}

export function listAncestors(path: string) {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

export function resolveFileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function resolveDirectory(path: string) {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function sumChanges(files: DiffFile[]) {
  return {
    added: files.reduce((sum, file) => sum + file.additions, 0),
    removed: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

export const FILE_STATUS: Record<DiffFile['status'], { letter: string; name: string; className: string }> = {
  added: { letter: 'A', name: 'Added', className: 'text-green-text' },
  removed: { letter: 'D', name: 'Deleted', className: 'text-red-text' },
  modified: { letter: 'M', name: 'Modified', className: 'text-fg-2' },
  renamed: { letter: 'R', name: 'Renamed', className: 'text-fg-2' },
};

export type RepoRow =
  | { kind: 'entry'; entry: RepoEntry; depth: number; open: boolean }
  | { kind: 'loading'; dir: string; depth: number }
  | { kind: 'error'; dir: string; depth: number; message: string };

export function listRepoRows(
  folders: ReadonlyMap<string, Loaded<RepoTree>>,
  expanded: ReadonlySet<string>,
  dir = '',
  depth = 0
): RepoRow[] {
  const loaded = folders.get(dir);
  if (loaded?.status === 'error') return [{ kind: 'error', dir, depth, message: loaded.message }];
  if (loaded?.status !== 'ready') return [{ kind: 'loading', dir, depth }];
  return loaded.value.entries.flatMap((entry): RepoRow[] => {
    const open = entry.kind === 'directory' && expanded.has(entry.path);
    const row: RepoRow = { kind: 'entry', entry, depth, open };
    return open ? [row, ...listRepoRows(folders, expanded, entry.path, depth + 1)] : [row];
  });
}

export function listOpenFolders(expanded: ReadonlySet<string>) {
  return ['', ...[...expanded].sort()];
}

export function isTreeSettled(rows: readonly RepoRow[]) {
  return rows.every((row) => row.kind !== 'loading');
}
