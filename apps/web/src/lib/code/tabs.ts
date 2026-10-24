import type { DiffFile, TaskDiff } from '@shinsa/core';
import type { CodeTabRef } from '@/lib/code/location.ts';
import { resolveFileName } from '@/lib/code/tree.ts';

export interface TabSource {
  tab: CodeTabRef;
  headPath: string | null;
  basePath: string | null;
  file: DiffFile | null;
}

export function resolveTabSource(tab: CodeTabRef, diff: TaskDiff | null): TabSource {
  const file =
    tab.kind === 'diff' ? (diff?.files.find((candidate) => candidate.path === tab.path) ?? null) : null;
  if (!file) return { tab, headPath: tab.path, basePath: null, file: null };
  return {
    tab,
    headPath: file.status === 'removed' ? null : file.path,
    basePath: file.status === 'added' ? null : (file.previousPath ?? file.path),
    file,
  };
}

export function listTabLabels(tabs: readonly CodeTabRef[]) {
  const names = tabs.map((tab) => resolveFileName(tab.path));
  return tabs.map((tab, index) => {
    const name = names[index] ?? tab.path;
    const clash = names.filter((candidate) => candidate === name).length > 1;
    if (!clash) return { name, hint: null };
    const parts = tab.path.split('/');
    return { name, hint: parts.at(-2) ?? null };
  });
}
