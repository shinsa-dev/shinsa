import type { DiffFile, TaskDiff } from '@shinsa/core';
import type { CodeFileRef } from '@/lib/code/location.ts';

export interface FileSource {
  file: CodeFileRef;
  headPath: string | null;
  basePath: string | null;
  change: DiffFile | null;
}

export function resolveFileSource(file: CodeFileRef, diff: TaskDiff | null): FileSource {
  const change =
    file.kind === 'diff' ? (diff?.files.find((candidate) => candidate.path === file.path) ?? null) : null;
  if (!change) return { file, headPath: file.path, basePath: null, change: null };
  return {
    file,
    headPath: change.status === 'removed' ? null : change.path,
    basePath: change.status === 'added' ? null : (change.previousPath ?? change.path),
    change,
  };
}
