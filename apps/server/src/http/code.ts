import { existsSync } from 'node:fs';
import {
  CODE_LIMITS,
  DomainError,
  resolveImageType,
  resolvePullRequestBase,
  selectTaskByReference,
  type TaskDiff,
  type TaskRefs,
  WORKING_REF,
} from '@shinsa/core';
import { resolveCommitDiff, resolveWorkingDiff } from '../git/diff.ts';
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
} from '../git/files.ts';
import { ObjectCache } from '../git/objects.ts';
import { resolveTaskCheckout, resolveTaskRefs } from '../git/task-refs.ts';
import type { Engine } from '../runtime/engine.ts';
import { assertRepoPath, resolveInside } from './paths.ts';
import type { ApiRoute } from './routes.ts';

interface CodeTask {
  task: NonNullable<Engine['state']['tasks'][string]>;
  repoPath: string;
  worktree: string | null;
}

type ResolvedRef = { kind: 'commit'; sha: string } | { kind: 'working'; worktree: string };

const IMMUTABLE = 'private, max-age=31536000, immutable';

const MAX_GLOB_LENGTH = 200;

function respondError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

function readTag(request: Request) {
  const url = new URL(request.url);
  return `"${Bun.hash(`${url.pathname}?${url.searchParams.toString()}`).toString(36)}"`;
}

async function respondCached(request: Request, pinned: boolean, body: () => Promise<unknown>) {
  if (!pinned) return Response.json(await body(), { headers: { 'Cache-Control': 'no-store' } });
  const tag = readTag(request);
  const headers = { 'Cache-Control': IMMUTABLE, ETag: tag };
  if (request.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers });
  return Response.json(await body(), { headers });
}

function readFlag(url: URL, name: string) {
  return url.searchParams.get(name) === '1';
}

function readSearch(url: URL): SearchQuery {
  const query = url.searchParams.get('q') ?? '';
  const glob = url.searchParams.get('glob')?.trim() || null;
  if (!query || query.length > CODE_LIMITS.queryLength || query.includes('\0'))
    throw new DomainError(
      'query_invalid',
      `Search for some text, up to ${CODE_LIMITS.queryLength} characters.`
    );
  if (glob && (glob.length > MAX_GLOB_LENGTH || /^[-:]|\0/.test(glob)))
    throw new DomainError('glob_invalid', 'Name the files to search as a pattern such as src/**/*.ts.');
  return {
    query,
    regex: readFlag(url, 'regex'),
    caseSensitive: readFlag(url, 'case'),
    wholeWord: readFlag(url, 'word'),
    glob,
  };
}

export function createCodeRoutes(engine: Engine, cache = new ObjectCache()): ApiRoute[] {
  function selectCodeTask(reference: string): CodeTask | null {
    const task = selectTaskByReference(engine.state, reference);
    const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
    if (!task || !repo || !existsSync(repo.path)) return null;
    return { task, repoPath: repo.path, worktree: resolveTaskCheckout(task) };
  }

  function resolveRefs(found: CodeTask, signal: AbortSignal) {
    const repo = engine.state.repos[found.task.repoId ?? ''];
    if (!repo) throw new DomainError('code_unavailable', 'This task has no repository.');
    return resolveTaskRefs(repo, found.task, resolvePullRequestBase(engine.state, found.task), signal);
  }

  async function resolveRef(
    found: CodeTask,
    value: string | null,
    signal: AbortSignal
  ): Promise<ResolvedRef> {
    if (value === WORKING_REF) {
      if (!found.worktree) throw new DomainError('ref_invalid', 'This task has no working copy any more.');
      return { kind: 'working', worktree: found.worktree };
    }
    const sha = value || (await resolveRefs(found, signal)).head;
    return { kind: 'commit', sha: await assertCommit(found.repoPath, sha, signal) };
  }

  function listPaths(found: CodeTask, ref: ResolvedRef, signal: AbortSignal) {
    if (ref.kind === 'working') return listWorkingPaths(ref.worktree, signal);
    return cache.read(
      `${found.repoPath}\0paths\0${ref.sha}`,
      () => listCommitPaths(found.repoPath, ref.sha, signal),
      (value) => value.paths.reduce((sum, path) => sum + path.length, 0)
    );
  }

  async function readTree(found: CodeTask, ref: ResolvedRef, dir: string, signal: AbortSignal) {
    if (ref.kind === 'working') return listWorkingTree(await listWorkingPaths(ref.worktree, signal), dir);
    return listCommitTree(found.repoPath, ref.sha, dir, signal);
  }

  function readFile(found: CodeTask, ref: ResolvedRef, path: string, signal: AbortSignal) {
    if (ref.kind === 'commit') return readCommitFile(found.repoPath, ref.sha, path, cache, signal);
    const absolute = resolveInside(ref.worktree, path);
    if (!absolute) throw new DomainError('path_invalid', 'That path leaves the working copy.');
    return Promise.resolve(readWorkingFile(absolute, path));
  }

  function readBytes(found: CodeTask, ref: ResolvedRef, path: string, signal: AbortSignal) {
    if (ref.kind === 'commit') return readCommitBytes(found.repoPath, ref.sha, path, signal);
    const absolute = resolveInside(ref.worktree, path);
    return Promise.resolve(absolute ? readWorkingBytes(absolute) : null);
  }

  async function resolveDiff(found: CodeTask, url: URL, signal: AbortSignal): Promise<TaskDiff> {
    const baseParam = url.searchParams.get('base');
    const headParam = url.searchParams.get('head');
    let refs: TaskRefs | null = null;
    if (!baseParam || !headParam) refs = await resolveRefs(found, signal);
    const base = await assertCommit(found.repoPath, baseParam || refs?.base || refs?.head || '', signal);
    const head = await resolveRef(
      found,
      headParam || (found.worktree ? WORKING_REF : (refs?.head ?? null)),
      signal
    );
    if (head.kind === 'working')
      return { base, head: WORKING_REF, files: await resolveWorkingDiff(head.worktree, base) };
    const files = await cache.read(
      `${found.repoPath}\0diff\0${base}\0${head.sha}`,
      () => resolveCommitDiff(found.repoPath, base, head.sha, signal),
      (value) => value.reduce((sum, file) => sum + file.patch.length, 0)
    );
    return { base, head: head.sha, files };
  }

  function route(
    name: string,
    respond: (found: CodeTask, request: Request, url: URL) => Promise<Response>
  ): ApiRoute {
    return {
      method: 'GET',
      pattern: new RegExp(`^/api/tasks/([^/]+)/${name}$`),
      respond: ([, id = ''], request) => {
        const found = selectCodeTask(decodeURIComponent(id));
        if (!found)
          return Promise.resolve(respondError('code_unavailable', 'This task has no code to read.', 404));
        return respond(found, request, new URL(request.url));
      },
    };
  }

  async function respondWith(
    found: CodeTask,
    request: Request,
    url: URL,
    read: (ref: ResolvedRef) => Promise<unknown>
  ) {
    const named = url.searchParams.get('ref');
    const ref = await resolveRef(found, named, request.signal);
    return respondCached(request, ref.kind === 'commit' && ref.sha === named, () => read(ref));
  }

  async function respondRaw(found: CodeTask, request: Request, url: URL) {
    const path = assertRepoPath(url.searchParams.get('path'));
    const type = resolveImageType(path);
    if (!type) return respondError('not_an_image', 'Only images are served as they are.', 400);
    const ref = await resolveRef(found, url.searchParams.get('ref'), request.signal);
    const bytes = await readBytes(found, ref, path, request.signal);
    if (!bytes) return respondError('file_missing', 'There is no such image at this commit.', 404);
    return new Response(bytes, {
      headers: {
        'Content-Type': type,
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': ref.kind === 'working' ? 'no-store' : IMMUTABLE,
      },
    });
  }

  return [
    route('refs', async (found, request) =>
      Response.json(await resolveRefs(found, request.signal), { headers: { 'Cache-Control': 'no-store' } })
    ),
    route('paths', (found, request, url) =>
      respondWith(found, request, url, (ref) => listPaths(found, ref, request.signal))
    ),
    route('tree', (found, request, url) => {
      const dir = assertRepoPath(url.searchParams.get('dir'), { root: true });
      return respondWith(found, request, url, (ref) => readTree(found, ref, dir, request.signal));
    }),
    route('blob', (found, request, url) => {
      const path = assertRepoPath(url.searchParams.get('path'));
      return respondWith(found, request, url, (ref) => readFile(found, ref, path, request.signal));
    }),
    route('raw', respondRaw),
    route('search', (found, request, url) => {
      const search = readSearch(url);
      return respondWith(found, request, url, (ref) =>
        ref.kind === 'working'
          ? searchFiles(ref.worktree, null, search, request.signal)
          : searchFiles(found.repoPath, ref.sha, search, request.signal)
      );
    }),
    route('diff', (found, request, url) => {
      const head = url.searchParams.get('head');
      const pinned = Boolean(url.searchParams.get('base') && head && head !== WORKING_REF);
      return respondCached(request, pinned, () => resolveDiff(found, url, request.signal));
    }),
  ];
}
