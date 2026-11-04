import { type FileContent, type Task, type TaskDiff, type TaskRefs, WORKING_REF } from '@shinsa/core';
import { Effect } from 'effect';
import { TOKEN_PRIORITY, tokenClient } from '@/lib/code/editor/tokens.ts';
import { type CodeFileRef, type CodeMode, parseCodeLocation } from '@/lib/code/location.ts';
import { type PairSource, resolvePaneContent, resolvePaneKey, resolveTextGuard } from '@/lib/code/pane.ts';
import { resolveViewRef } from '@/lib/code/refs.ts';
import { hasOneSide, resolveFileSource } from '@/lib/code/source.ts';
import { listAncestors } from '@/lib/code/tree.ts';
import {
  type Loaded,
  requestFileContent,
  requestFileDiff,
  requestRepoPaths,
  requestRepoTree,
  requestTaskDiff,
  requestTaskRefs,
  resolveRefsVersion,
} from '@/lib/connection/code.ts';
import { scheduleIdle } from '@/lib/idle.ts';
import { forkApp, runApp } from '@/lib/runtime/app.ts';
import { enterPromise } from '@/lib/runtime/promise.ts';
import { listCodeModes } from '@/lib/tasks/tabs.ts';

function selectFirstFile(mode: CodeMode, diff: TaskDiff | null): CodeFileRef | null {
  const changed = mode === 'changes' ? diff?.files[0] : undefined;
  return changed ? { kind: 'diff', path: changed.path } : null;
}

const readText = Effect.fn('CodePrefetch.readText')(function* (
  task: Task,
  ref: string,
  path: string,
  priority: number
) {
  const file = yield* enterPromise(() => requestFileContent(task, ref, path));
  if (file.content !== null) tokenClient.prefetch(path, file.content, priority);
  return file;
});

const readFile = Effect.fn('CodePrefetch.readFile')(function* (
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null,
  priority: number = TOKEN_PRIORITY.prefetch
) {
  const source = resolveFileSource(file, diff);
  const basePath = source.basePath ?? source.baselinePath;
  return yield* Effect.all(
    [
      source.headPath ? readText(task, ref, source.headPath, priority) : Effect.succeed(null),
      basePath && refs.base ? readText(task, refs.base, basePath, priority) : Effect.succeed(null),
    ],
    { concurrency: 'unbounded' }
  );
});

const readTree = Effect.fn('CodePrefetch.readTree')(function* (task: Task, ref: string, dir: string) {
  return yield* enterPromise(() => requestRepoTree(task, ref, dir));
});

const readDiff = Effect.fn('CodePrefetch.readDiff')(function* (task: Task, base: string, head: string) {
  return yield* enterPromise(() => requestTaskDiff(task, base, head));
});

const readAncestors = Effect.fn('CodePrefetch.readAncestors')(function* (
  task: Task,
  ref: string,
  path: string
) {
  return yield* Effect.all(
    listAncestors(path).map((dir) => readTree(task, ref, dir)),
    { concurrency: 'unbounded' }
  );
});

function resolveLoaded(file: FileContent | null): Loaded<FileContent> {
  return file ? { status: 'ready', value: file } : { status: 'idle' };
}

const readPairSource = Effect.fn('CodePrefetch.readPairSource')(function* (
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null
) {
  const source = resolveFileSource(file, diff);
  if (!source.change || hasOneSide(source)) return null;
  const [head, base] = yield* readFile(task, refs, ref, file, diff);
  const content = resolvePaneContent({
    headPath: source.headPath,
    basePath: source.basePath,
    diffing: true,
    head: resolveLoaded(head),
    base: resolveLoaded(base),
  });
  if (content.kind !== 'text' || content.original === null) return null;
  if (resolveTextGuard(file.path, [content.content, content.original])) return null;
  const pair: PairSource = {
    key: resolvePaneKey(ref, file),
    path: file.path,
    content: content.content,
    original: content.original,
  };
  return pair;
});

const readTaskCode = Effect.fn('CodePrefetch.readTaskCode')(function* (task: Task, search: string) {
  const params = new URLSearchParams(search);
  const location = parseCodeLocation((name) => params.get(name), listCodeModes(task));
  const refs = yield* enterPromise(() => requestTaskRefs(task));
  const ref = resolveViewRef(location.ref, refs);
  const reviewing = listCodeModes(task).includes('changes');
  const [diff] = yield* Effect.all(
    [
      reviewing && refs.base ? readDiff(task, refs.base, ref) : Effect.succeed(null),
      refs.base && ref !== refs.head ? readDiff(task, refs.base, refs.head) : Effect.succeed(null),
      readTree(task, ref, ''),
      enterPromise(() => requestRepoPaths(task, ref)),
    ],
    { concurrency: 'unbounded' }
  );
  const file = location.active ?? selectFirstFile(location.mode, diff);
  if (!file) return null;
  yield* Effect.all([readFile(task, refs, ref, file, diff), readAncestors(task, ref, file.path)], {
    concurrency: 'unbounded',
  });
  return file.path;
});

const readSnippets = Effect.fn('CodePrefetch.readSnippets')(function* (task: Task, paths: readonly string[]) {
  const refs = yield* enterPromise(() => requestTaskRefs(task));
  const base = refs.base;
  if (!base) return;
  const diff = yield* readDiff(task, base, refs.head);
  yield* Effect.forEach(
    [...new Set(paths)].slice(0, SNIPPET_PREFETCH_LIMIT),
    (path) => {
      const listed = diff.files.find((file) => file.path === path);
      return Effect.all(
        [
          enterPromise(() => requestFileContent(task, refs.head, path)),
          listed && !listed.patchOmitted
            ? Effect.succeed(null)
            : enterPromise(() => requestFileDiff(task, base, refs.head, path)),
        ],
        { concurrency: 'unbounded' }
      );
    },
    { concurrency: 'unbounded', discard: true }
  );
});

export function prefetchFile(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null,
  priority: number = TOKEN_PRIORITY.prefetch
) {
  forkApp(Effect.ignore(readFile(task, refs, ref, file, diff, priority)));
}

export function requestPairSource(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null
) {
  return runApp(readPairSource(task, refs, ref, file, diff));
}

export function prefetchPair(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null,
  build: (source: PairSource) => void
) {
  forkApp(
    readPairSource(task, refs, ref, file, diff).pipe(
      Effect.tap((source) =>
        Effect.sync(() => {
          if (source) schedulePrefetch(() => build(source));
        })
      ),
      Effect.ignore
    )
  );
}

const NEIGHBOUR_DELAY_MS = 300;

export function schedulePrefetch(run: () => void) {
  return scheduleIdle(run, NEIGHBOUR_DELAY_MS);
}

export function prefetchFolder(task: Task, ref: string, dir: string) {
  forkApp(Effect.ignore(readTree(task, ref, dir)));
}

export function prefetchAncestors(task: Task, ref: string, path: string) {
  forkApp(Effect.ignore(readAncestors(task, ref, path)));
}

export function listOtherRefs(refs: TaskRefs, ref: string) {
  const all = [refs.head, refs.working ? WORKING_REF : null, refs.base];
  return [...new Set(all)].filter((each): each is string => each !== null && each !== ref);
}

export function prefetchOtherRefs(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef | null,
  diff: TaskDiff | null,
  reviewing: boolean
) {
  for (const other of listOtherRefs(refs, ref)) {
    forkApp(
      Effect.ignore(
        Effect.all(
          [
            readTree(task, other, ''),
            reviewing && refs.base ? readDiff(task, refs.base, other) : Effect.void,
            file ? readFile(task, refs, other, file, diff) : Effect.void,
            file ? readAncestors(task, other, file.path) : Effect.void,
          ],
          { concurrency: 'unbounded' }
        )
      )
    );
  }
}

export function prefetchTaskCode(task: Task, search: string): Promise<string | null> {
  return runApp(readTaskCode(task, search));
}

export const SNIPPET_PREFETCH_LIMIT = 8;

export function prefetchSnippets(task: Task, paths: readonly string[]) {
  if (paths.length === 0) return;
  forkApp(Effect.ignore(readSnippets(task, paths)));
}

const prefetched = new Set<string>();

export function claimPrefetch(task: Task) {
  const key = `${task.id}:${resolveRefsVersion(task)}`;
  if (prefetched.has(key)) return null;
  prefetched.add(key);
  return () => {
    prefetched.delete(key);
  };
}
