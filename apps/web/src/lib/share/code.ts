import { parseUnifiedDiff, type TaskDiff, type TaskRefs } from '@shinsa/core';
import type { CodeSource } from '@/lib/connection/code.ts';

export const SHARED_BASE = 'shared-base';

export const SHARED_HEAD = 'shared-head';

export const NO_SHARED_CODE = 'This task shares no code.';

export const ONLY_CHANGES = 'Only the changes of this task are shared.';

export function createSharedCodeSource(readDiff: (() => Promise<string>) | null, branch: string | null): CodeSource {
  let files: ReturnType<typeof parseUnifiedDiff> | null = null;
  const listFiles = async () => {
    if (!readDiff) throw new Error(NO_SHARED_CODE);
    files ??= parseUnifiedDiff(await readDiff());
    return files;
  };
  return async (name, params) => {
    if (name === 'refs') {
      await listFiles();
      const refs: TaskRefs = {
        head: SHARED_HEAD,
        base: SHARED_BASE,
        branch,
        defaultBranch: SHARED_BASE,
        working: false,
        dirty: false,
        commits: [],
      };
      return refs;
    }
    if (name === 'diff') {
      const path = params.get('path');
      const all = await listFiles();
      const diff: TaskDiff = {
        base: SHARED_BASE,
        head: SHARED_HEAD,
        files: path ? all.filter((file) => file.path === path) : all,
      };
      return diff;
    }
    throw new Error(ONLY_CHANGES);
  };
}
