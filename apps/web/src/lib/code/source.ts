import type { DiffFile, TaskDiff } from '@shinsa/core';
import type { CodeFileRef } from '@/lib/code/location.ts';

export interface FileSource {
  file: CodeFileRef;
  headPath: string | null;
  basePath: string | null;
  baselinePath: string | null;
  change: DiffFile | null;
}

function resolveBaselinePath(change: DiffFile | undefined) {
  if (!change || change.binary || change.status === 'added' || change.status === 'removed') return null;
  return change.previousPath ?? change.path;
}

export function resolveFileSource(file: CodeFileRef, diff: TaskDiff | null): FileSource {
  const change = diff?.files.find((candidate) => candidate.path === file.path);
  if (file.kind === 'file' || !change) {
    return {
      file,
      headPath: file.path,
      basePath: null,
      baselinePath: file.kind === 'file' ? resolveBaselinePath(change) : null,
      change: null,
    };
  }
  return {
    file,
    headPath: change.status === 'removed' ? null : change.path,
    basePath: change.status === 'added' ? null : (change.previousPath ?? change.path),
    baselinePath: null,
    change,
  };
}

export function hasOneSide(source: FileSource) {
  return source.change !== null && (source.headPath === null || source.basePath === null);
}
