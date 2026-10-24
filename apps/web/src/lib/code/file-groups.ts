import type { DiffFile } from '@shinsa/core';

interface FileGroup {
  directory: string;
  files: DiffFile[];
}

export const FILE_STATUS: Record<DiffFile['status'], { letter: string; name: string; className: string }> = {
  added: { letter: 'A', name: 'Added', className: 'text-green-text' },
  removed: { letter: 'D', name: 'Deleted', className: 'text-red-text' },
  modified: { letter: 'M', name: 'Modified', className: 'text-fg-2' },
  renamed: { letter: 'R', name: 'Renamed', className: 'text-fg-2' },
};

export function listFileGroups(files: DiffFile[]): FileGroup[] {
  const groups = new Map<string, DiffFile[]>();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const slash = file.path.lastIndexOf('/');
    const directory = slash >= 0 ? file.path.slice(0, slash) : '';
    groups.set(directory, [...(groups.get(directory) ?? []), file]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([directory, grouped]) => ({ directory, files: grouped }));
}

export function sumChanges(files: DiffFile[]) {
  return {
    added: files.reduce((sum, file) => sum + file.additions, 0),
    removed: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
