import { existsSync } from 'node:fs';
import {
  CODE_LIMITS,
  resolveImageType,
  resolveRoundBase,
  type SearchLine,
  type SearchMatch,
  selectTaskByReference,
  type TaskDiff,
  type TaskRefs,
  WORKING_REF,
} from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { CodeUnavailable, FileMissing, RequestFailed } from '@shinsa/core/engine-api/schema';
import { Effect, Queue, Stream } from 'effect';
import { type HttpServerRequest, HttpServerResponse } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { assertRepoPath, resolveInside } from '../../../files/paths.ts';
import { CatFilePool } from '../../../git/blobs.ts';
import { resolveCommitDiff, resolveWorkingDiff } from '../../../git/diff.ts';
import {
  assertCommit,
  listCommitPaths,
  listCommitTree,
  listWorkingPaths,
  listWorkingTree,
  readCommitBytes,
  readCommitFile,
  readWorkingBytes,
  readWorkingFile,
  type SearchQuery,
  searchFiles,
} from '../../../git/files.ts';
import { ObjectCache } from '../../../git/objects.ts';
import { resolveTaskCheckout, resolveTaskRefs } from '../../../git/task-refs.ts';
import { requestPromise, requestSync } from '../../failures.ts';
import { REQUEST_FAILED } from '../../schema.ts';
import { HttpServices } from '../../services/service.ts';
import {
  CODE_MISSING_MESSAGE,
  type CodeTask,
  GLOB_FAILURE,
  IMAGE_MISSING_MESSAGE,
  IMMUTABLE,
  MAX_GLOB_LENGTH,
  NDJSON,
  NO_REPOSITORY,
  NO_STORE,
  NO_WORKING_COPY,
  NOT_AN_IMAGE,
  PATH_LEAVES_WORKTREE,
  RAW_SAFETY,
  type ResolvedRef,
  SEARCH_FAILED,
} from './schema.ts';

export const CodeHandlers = HttpApiBuilder.group(
  EngineApi,
  'code',
  Effect.fn('CodeHandlers')(function* (handlers) {
    const { engine } = yield* HttpServices;
    const cache = new ObjectCache();
    const blobs = yield* Effect.acquireRelease(
      Effect.sync(() => new CatFilePool()),
      (pool) => Effect.sync(() => pool.close())
    );

    const findCodeTask = Effect.fn('CodeHandlers.findCodeTask')(function* (reference: string) {
      const task = selectTaskByReference(engine.state, reference);
      const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
      if (!task || !repo || !existsSync(repo.path))
        return yield* new CodeUnavailable({ message: CODE_MISSING_MESSAGE });
      const found: CodeTask = { task, repoPath: repo.path, worktree: resolveTaskCheckout(task) };
      return found;
    });

    const resolveRefs = Effect.fn('CodeHandlers.resolveRefs')(function* (found: CodeTask) {
      const repo = engine.state.repos[found.task.repoId ?? ''];
      if (!repo) return yield* new RequestFailed(NO_REPOSITORY);
      return yield* requestPromise((signal): Promise<TaskRefs> =>
        resolveTaskRefs(repo, found.task, resolveRoundBase(found.task), signal)
      );
    });

    const resolveRef = Effect.fn('CodeHandlers.resolveRef')(function* (
      found: CodeTask,
      value: string | null
    ) {
      if (value === WORKING_REF) {
        if (!found.worktree) return yield* new RequestFailed(NO_WORKING_COPY);
        const working: ResolvedRef = { kind: 'working', worktree: found.worktree };
        return working;
      }
      const named = value || (yield* resolveRefs(found)).head;
      const sha = yield* requestPromise((signal) => assertCommit(found.repoPath, named, signal));
      const commit: ResolvedRef = { kind: 'commit', sha };
      return commit;
    });

    const listPaths = (found: CodeTask, ref: ResolvedRef) =>
      requestPromise((signal) => {
        if (ref.kind === 'working') return listWorkingPaths(ref.worktree, signal);
        return cache.read(
          `${found.repoPath}\0paths\0${ref.sha}`,
          () => listCommitPaths(found.repoPath, ref.sha, signal),
          (value) => value.paths.reduce((sum, path) => sum + path.length, 0)
        );
      });

    const readTree = (found: CodeTask, ref: ResolvedRef, dir: string) => {
      if (ref.kind === 'working')
        return Effect.map(listPaths(found, ref), (paths) => listWorkingTree(paths, dir));
      return requestPromise((signal) =>
        cache.read(
          `${found.repoPath}\0tree\0${ref.sha}\0${dir}`,
          () => listCommitTree(found.repoPath, ref.sha, dir, signal, blobs.select(found.repoPath)),
          (value) => value.entries.reduce((sum, entry) => sum + entry.path.length + 32, 0)
        )
      );
    };

    const readFile = Effect.fn('CodeHandlers.readFile')(function* (
      found: CodeTask,
      ref: ResolvedRef,
      path: string
    ) {
      if (ref.kind === 'commit') {
        const reader = blobs.select(found.repoPath);
        return yield* requestPromise((signal) =>
          readCommitFile(found.repoPath, ref.sha, path, cache, signal, reader)
        );
      }
      const absolute = resolveInside(ref.worktree, path);
      if (!absolute) return yield* new RequestFailed(PATH_LEAVES_WORKTREE);
      return yield* requestSync(() => readWorkingFile(absolute, path));
    });

    const readBytes = (found: CodeTask, ref: ResolvedRef, path: string) => {
      if (ref.kind === 'commit')
        return requestPromise((signal) =>
          readCommitBytes(found.repoPath, ref.sha, path, signal, blobs.select(found.repoPath))
        );
      const absolute = resolveInside(ref.worktree, path);
      return requestSync(() => (absolute ? readWorkingBytes(absolute) : null));
    };

    const search = (
      found: CodeTask,
      ref: ResolvedRef,
      query: SearchQuery,
      onMatches?: (matches: SearchMatch[]) => void
    ) =>
      requestPromise((signal) =>
        ref.kind === 'working'
          ? searchFiles(ref.worktree, null, query, signal, onMatches)
          : searchFiles(found.repoPath, ref.sha, query, signal, onMatches)
      );

    const readSearch = Effect.fn('CodeHandlers.readSearch')(function* (query: {
      readonly q?: string;
      readonly glob?: string;
      readonly regex?: string;
      readonly case?: string;
      readonly word?: string;
    }) {
      const text = query.q ?? '';
      const glob = query.glob?.trim() || null;
      if (!text || text.length > CODE_LIMITS.queryLength || text.includes('\0'))
        return yield* new RequestFailed({
          code: 'query_invalid',
          message: `Search for up to ${CODE_LIMITS.queryLength} characters.`,
        });
      if (glob && (glob.length > MAX_GLOB_LENGTH || /^[-:]|\0/.test(glob)))
        return yield* new RequestFailed(GLOB_FAILURE);
      const parsed: SearchQuery = {
        query: text,
        regex: query.regex === '1',
        caseSensitive: query.case === '1',
        wholeWord: query.word === '1',
        glob,
      };
      return parsed;
    });

    const respondCached = Effect.fn('CodeHandlers.respondCached')(function* <E>(
      request: HttpServerRequest.HttpServerRequest,
      pinned: boolean,
      body: Effect.Effect<unknown, E>
    ) {
      if (!pinned)
        return HttpServerResponse.jsonUnsafe(yield* body, { headers: { 'Cache-Control': NO_STORE } });
      const url = new URL(request.originalUrl);
      const tag = `"${Bun.hash(`${url.pathname}?${url.searchParams.toString()}`).toString(36)}"`;
      const headers = { 'Cache-Control': IMMUTABLE, ETag: tag };
      if (request.headers['if-none-match'] === tag) return HttpServerResponse.empty({ status: 304, headers });
      return HttpServerResponse.jsonUnsafe(yield* body, { headers });
    });

    const respondAt = Effect.fn('CodeHandlers.respondAt')(function* <E>(
      found: CodeTask,
      request: HttpServerRequest.HttpServerRequest,
      named: string | undefined,
      read: (ref: ResolvedRef) => Effect.Effect<unknown, E>
    ) {
      const ref = yield* resolveRef(found, named ?? null);
      return yield* respondCached(request, ref.kind === 'commit' && ref.sha === named, read(ref));
    });

    const streamSearch = (found: CodeTask, named: string | null, query: SearchQuery) =>
      Stream.callback<SearchLine>((queue) =>
        Effect.gen(function* () {
          const ref = yield* resolveRef(found, named);
          const result = yield* search(found, ref, query, (matches) =>
            Queue.offerUnsafe(queue, { kind: 'matches', matches })
          );
          Queue.offerUnsafe(queue, { kind: 'done', result: { ...result, matches: [] } });
        }).pipe(
          Effect.catch((failure: RequestFailed) =>
            Effect.sync(() =>
              Queue.offerUnsafe(queue, {
                kind: 'failed',
                code: failure.code === REQUEST_FAILED ? SEARCH_FAILED : failure.code,
                message: failure.message,
              })
            )
          ),
          Effect.ensuring(Queue.end(queue))
        )
      ).pipe(
        Stream.map((line) => `${JSON.stringify(line)}\n`),
        Stream.encodeText
      );

    const resolveDiff = Effect.fn('CodeHandlers.resolveDiff')(function* (
      found: CodeTask,
      query: {
        readonly base?: string;
        readonly head?: string;
        readonly path?: string;
        readonly previous?: string;
      }
    ) {
      const paths =
        query.path === undefined
          ? null
          : yield* requestSync(() => [
              ...(query.previous ? [assertRepoPath(query.previous)] : []),
              assertRepoPath(query.path ?? null),
            ]);
      const refs = !query.base || !query.head ? yield* resolveRefs(found) : null;
      const baseRef = query.base || refs?.base || refs?.head || '';
      const base = yield* requestPromise((signal) => assertCommit(found.repoPath, baseRef, signal));
      const head = yield* resolveRef(
        found,
        query.head || (found.worktree ? WORKING_REF : (refs?.head ?? null))
      );
      if (head.kind === 'working') {
        const files = yield* requestPromise((signal) =>
          resolveWorkingDiff(head.worktree, base, paths, signal)
        );
        const working: TaskDiff = { base, head: WORKING_REF, files };
        return working;
      }
      const files = yield* requestPromise((signal) =>
        cache.read(
          `${found.repoPath}\0diff\0${base}\0${head.sha}\0${paths?.join('\0') ?? ''}`,
          () => resolveCommitDiff(found.repoPath, base, head.sha, signal, paths),
          (value) => value.reduce((sum, file) => sum + file.patch.length + file.path.length, 0)
        )
      );
      const pinned: TaskDiff = { base, head: head.sha, files };
      return pinned;
    });

    return handlers
      .handle(
        'refs',
        Effect.fn('CodeHandlers.refs')(function* ({ params }) {
          const found = yield* findCodeTask(params.taskRef);
          const refs = yield* resolveRefs(found);
          return HttpServerResponse.jsonUnsafe(refs, { headers: { 'Cache-Control': NO_STORE } });
        })
      )
      .handle('paths', ({ params, query, request }) =>
        Effect.flatMap(findCodeTask(params.taskRef), (found) =>
          respondAt(found, request, query.ref, (ref) => listPaths(found, ref))
        )
      )
      .handle(
        'tree',
        Effect.fn('CodeHandlers.tree')(function* ({ params, query, request }) {
          const found = yield* findCodeTask(params.taskRef);
          const dir = yield* requestSync(() => assertRepoPath(query.dir ?? null, { root: true }));
          return yield* respondAt(found, request, query.ref, (ref) => readTree(found, ref, dir));
        })
      )
      .handle(
        'blob',
        Effect.fn('CodeHandlers.blob')(function* ({ params, query, request }) {
          const found = yield* findCodeTask(params.taskRef);
          const path = yield* requestSync(() => assertRepoPath(query.path ?? null));
          return yield* respondAt(found, request, query.ref, (ref) => readFile(found, ref, path));
        })
      )
      .handle(
        'raw',
        Effect.fn('CodeHandlers.raw')(function* ({ params, query }) {
          const found = yield* findCodeTask(params.taskRef);
          const path = yield* requestSync(() => assertRepoPath(query.path ?? null));
          const type = resolveImageType(path);
          if (!type) return yield* new RequestFailed(NOT_AN_IMAGE);
          const ref = yield* resolveRef(found, query.ref ?? null);
          const bytes = yield* readBytes(found, ref, path);
          if (!bytes) return yield* new FileMissing({ message: IMAGE_MISSING_MESSAGE });
          return HttpServerResponse.uint8Array(bytes, {
            contentType: type,
            headers: { ...RAW_SAFETY, 'Cache-Control': ref.kind === 'commit' ? IMMUTABLE : NO_STORE },
          });
        })
      )
      .handle(
        'search',
        Effect.fn('CodeHandlers.search')(function* ({ params, query, request }) {
          const found = yield* findCodeTask(params.taskRef);
          const parsed = yield* readSearch(query);
          if (request.headers.accept?.includes(NDJSON))
            return HttpServerResponse.stream(streamSearch(found, query.ref ?? null, parsed), {
              contentType: NDJSON,
              headers: { 'Cache-Control': NO_STORE },
            });
          return yield* respondAt(found, request, query.ref, (ref) => search(found, ref, parsed));
        })
      )
      .handle(
        'diff',
        Effect.fn('CodeHandlers.diff')(function* ({ params, query, request }) {
          const found = yield* findCodeTask(params.taskRef);
          const pinned = Boolean(query.base && query.head && query.head !== WORKING_REF);
          return yield* respondCached(request, pinned, resolveDiff(found, query));
        })
      );
  })
);
