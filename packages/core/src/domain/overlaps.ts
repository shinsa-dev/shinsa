import type { Task } from './types.ts';

const OVERLAP_PATH_LIMIT = 5;

export interface OverlapNote {
  handle: string | null;
  title: string;
  paths: readonly string[];
}

export function listNewOverlapPaths(
  task: Pick<Task, 'overlaps'>,
  otherTaskId: string,
  paths: readonly string[]
) {
  const known = new Set(task.overlaps?.find((overlap) => overlap.taskId === otherTaskId)?.paths ?? []);
  return [...new Set(paths)].filter((path) => !known.has(path)).sort();
}

function describePaths(paths: readonly string[]) {
  const shown = paths.slice(0, OVERLAP_PATH_LIMIT).map((path) => `\`${path}\``);
  const more = paths.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

function describeOverlapNote(note: OverlapNote) {
  return `${note.handle ? `${note.handle} ` : ''}“${note.title}” (${describePaths(note.paths)})`;
}

export function describeOverlaps(notes: readonly OverlapNote[]) {
  const listed = notes.map(describeOverlapNote).join('; ');
  if (notes.length === 1) {
    return `Another open task changed files this task also changes: ${listed}. Keep your changes to those files to what this task needs, and call \`list_repository_work\` to see its branch, its stage and whether an agent works on it now.`;
  }
  return `Other open tasks changed files this task also changes: ${listed}. Keep your changes to those files to what this task needs, and call \`list_repository_work\` to see their branches, their stages and whether an agent works on them now.`;
}
