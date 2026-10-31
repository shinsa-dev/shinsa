import {
  type DiffFile,
  type FileContent,
  parseUnifiedDiff,
  type Task,
  type TaskDiff,
  type TaskRefs,
} from '@shinsa/core';
import type { CodeSource } from '@/lib/connection/code.ts';

export const SHARED_BASE = 'shared-base';

export const SHARED_HEAD = 'shared-head';

export const NO_SHARED_CODE = 'This task shares no code.';

export const ONLY_CHANGES = 'Only the files this task changed are shared.';

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export interface SharedCodeReads {
  readDiff: (() => Promise<string>) | null;
  readCode: (() => Promise<string>) | null;
  branch: string | null;
  head?: string;
}

export function resolveSharedHead(task: Pick<Task, 'pullRequest'>) {
  return `${SHARED_HEAD}-${task.pullRequest?.headSha ?? 'none'}`;
}

function listPatchLines(patch: string) {
  const lines = patch.split('\n');
  const first = lines.findIndex((line) => HUNK.test(line));
  return first === -1 ? [] : lines.slice(first);
}

function resolveSideContent(patch: string, mark: '+' | '-') {
  const lines = listPatchLines(patch)
    .filter((line) => line.startsWith(mark) || line.startsWith(' '))
    .map((line) => line.slice(1));
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export function resolveBaseContent(head: string, patch: string) {
  const headLines = head.split('\n');
  const base: string[] = [];
  let cursor = 0;
  for (const line of listPatchLines(patch)) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      const start = Number(hunk[1]) - 1;
      base.push(...headLines.slice(cursor, start));
      cursor = start;
    } else if (line.startsWith('-')) {
      base.push(line.slice(1));
    } else if (line.startsWith('+')) {
      cursor += 1;
    } else if (line.startsWith(' ')) {
      base.push(headLines[cursor] ?? line.slice(1));
      cursor += 1;
    }
  }
  base.push(...headLines.slice(cursor));
  return base.join('\n');
}

function createFileContent(ref: string, path: string, content: string | null): FileContent {
  return {
    ref,
    path,
    content,
    size: content?.length ?? 0,
    binary: false,
    tooLarge: false,
    missing: content === null,
    image: null,
  };
}

function resolveHeadContent(file: DiffFile, whole: Record<string, string>) {
  if (file.status === 'added') return resolveSideContent(file.patch, '+');
  if (file.status === 'removed') return null;
  return whole[file.path] ?? null;
}

function resolveSharedBase(file: DiffFile, whole: Record<string, string>) {
  if (file.status === 'removed') return resolveSideContent(file.patch, '-');
  if (file.status === 'added') return null;
  const head = whole[file.path];
  return head === undefined ? null : resolveBaseContent(head, file.patch);
}

export function createSharedCodeSource({
  readDiff,
  readCode,
  branch,
  head = SHARED_HEAD,
}: SharedCodeReads): CodeSource {
  let files: DiffFile[] | null = null;
  let whole: Promise<Record<string, string>> | null = null;
  const listFiles = async () => {
    if (!readDiff) throw new Error(NO_SHARED_CODE);
    files ??= parseUnifiedDiff(await readDiff());
    return files;
  };
  const listWhole = () => {
    whole ??= readCode
      ? readCode().then((text) => (JSON.parse(text) as { files: Record<string, string> }).files)
      : Promise.resolve({});
    return whole;
  };
  const readBlob = async (ref: string, path: string) => {
    const all = await listFiles();
    const file = all.find((candidate) => candidate.path === path || candidate.previousPath === path);
    if (!file) throw new Error(ONLY_CHANGES);
    const known = await listWhole();
    const content = ref === head ? resolveHeadContent(file, known) : resolveSharedBase(file, known);
    return createFileContent(ref, path, content);
  };
  return async (name, params) => {
    if (name === 'refs') {
      await listFiles();
      const refs: TaskRefs = {
        head,
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
        head,
        files: path ? all.filter((file) => file.path === path) : all,
      };
      return diff;
    }
    if (name === 'blob') return readBlob(params.get('ref') ?? head, params.get('path') ?? '');
    throw new Error(ONLY_CHANGES);
  };
}
