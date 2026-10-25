import { existsSync } from 'node:fs';
import {
  CODE_LIMITS,
  DomainError,
  resolveImageType,
  resolvePullRequestBase,
  type SearchLine,
  type SearchMatch,
  type SearchResult,
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
import { describeError } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { LedgerStore } from '../workspaces/ledger.ts';
import { assertRepoPath, resolveInside } from './paths.ts';
import type { ApiRoute } from './routes.ts';

interface CodeTask {
  task: NonNullable<Engine['state']['tasks'][string]>;
  repoPath: string;
  worktree: string | null;
  workspace: string | null;
}

type ResolvedRef =
  | { kind: 'commit'; sha: string }
  | { kind: 'working'; worktree: string }
  | { kind: 'owned'; sha: string; worktree: string; owned: ReadonlySet<string> };

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

function isOnDisk(worktree: string, path: string) {
  const absolute = resolveInside(worktree, path);
  return absolute !== null && existsSync(absolute);
}

function resolveSharedCheckout(task: CodeTask['task']) {
  if (task.workspace !== 'gitbutler' || !task.worktreePath) return null;
  return existsSync(task.worktreePath) ? task.worktreePath : null;
}

function mergeOwnedMatches(
  committed: SearchResult,
  working: SearchResult,
  owned: ReadonlySet<string>
): SearchResult {
  const matches = [
    ...committed.matches.filter((match) => !owned.has(match.path)),
    ...working.matches.filter((match) => owned.has(match.path)),
  ].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return {
    ref: WORKING_REF,
    matches: matches.slice(0, CODE_LIMITS.matches),
    truncated: committed.truncated || working.truncated || matches.length > CODE_LIMITS.matches,
    timedOut: committed.timedOut || working.timedOut,
  };
}

function isWorkingRef(ref: ResolvedRef) {
  return ref.kind !== 'commit';
}

export function createCodeRoutes(
  engine: Engine,
  ledgers: LedgerStore,
  cache = new ObjectCache()
): ApiRoute[] {
  function selectCodeTask(reference: string): CodeTask | null {
    const task = selectTaskByReference(engine.state, reference);
    const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
    if (!task || !repo || !existsSync(repo.path)) return null;
    return {
      task,
      repoPath: repo.path,
      worktree: resolveTaskCheckout(task),
      workspace: resolveSharedCheckout(task),
    };
  }

  function listOwnedPaths(found: CodeTask) {
    const owners = ledgers.read(found.task.repoId ?? '').owners;
    return new Set(
      Object.entries(owners)
        .filter(([, owner]) => owner.taskId === found.task.id)
        .map(([path]) => path)
    );
  }

  async function resolveRefs(found: CodeTask, signal: AbortSignal): Promise<TaskRefs> {
    const repo = engine.state.repos[found.task.repoId ?? ''];
    if (!repo) throw new DomainError('code_unavailable', 'This task has no repository.');
    const refs = await resolveTaskRefs(
      repo,
      found.task,
      resolvePullRequestBase(engine.state, found.task),
      signal
    );
    if (!found.workspace) return refs;
    return { ...refs, working: true, dirty: listOwnedPaths(found).size > 0 };
  }

  async function resolveRef(
    found: CodeTask,
    value: string | null,
    signal: AbortSignal
  ): Promise<ResolvedRef> {
    if (value === WORKING_REF && found.workspace) {
      const { head } = await resolveRefs(found, signal);
      return { kind: 'owned', sha: head, worktree: found.workspace, owned: listOwnedPaths(found) };
    }
    if (value === WORKING_REF) {
      if (!found.worktree) throw new DomainError('ref_invalid', 'This task has no working copy any more.');
      return { kind: 'working', worktree: found.worktree };
    }
    const sha = value || (await resolveRefs(found, signal)).head;
    return { kind: 'commit', sha: await assertCommit(found.repoPath, sha, signal) };
  }

  function listCommitPathsCached(found: CodeTask, sha: string, signal: AbortSignal) {
    return cache.read(
      `${found.repoPath}\0paths\0${sha}`,
      () => listCommitPaths(found.repoPath, sha, signal),
      (value) => value.paths.reduce((sum, path) => sum + path.length, 0)
    );
  }

  async function listPaths(found: CodeTask, ref: ResolvedRef, signal: AbortSignal) {
    if (ref.kind === 'working') return listWorkingPaths(ref.worktree, signal);
    const listed = await listCommitPathsCached(found, ref.sha, signal);
    if (ref.kind === 'commit') return listed;
    const paths = new Set(listed.paths);
    for (const path of ref.owned) {
      if (isOnDisk(ref.worktree, path)) paths.add(path);
      else paths.delete(path);
    }
    return { ref: WORKING_REF, paths: [...paths].sort(), truncated: listed.truncated };
  }

  async function readTree(found: CodeTask, ref: ResolvedRef, dir: string, signal: AbortSignal) {
    if (ref.kind === 'commit') return listCommitTree(found.repoPath, ref.sha, dir, signal);
    return listWorkingTree(await listPaths(found, ref, signal), dir);
  }

  async function readFile(found: CodeTask, ref: ResolvedRef, path: string, signal: AbortSignal) {
    if (ref.kind === 'commit') return readCommitFile(found.repoPath, ref.sha, path, cache, signal);
    if (ref.kind === 'owned' && !ref.owned.has(path)) {
      return { ...(await readCommitFile(found.repoPath, ref.sha, path, cache, signal)), ref: WORKING_REF };
    }
    const absolute = resolveInside(ref.worktree, path);
    if (!absolute) throw new DomainError('path_invalid', 'That path leaves the working copy.');
    return readWorkingFile(absolute, path);
  }

  function readBytes(found: CodeTask, ref: ResolvedRef, path: string, signal: AbortSignal) {
    if (ref.kind === 'commit' || (ref.kind === 'owned' && !ref.owned.has(path))) {
      return readCommitBytes(found.repoPath, ref.sha, path, signal);
    }
    const absolute = resolveInside(ref.worktree, path);
    return Promise.resolve(absolute ? readWorkingBytes(absolute) : null);
  }

  async function search(
    found: CodeTask,
    ref: ResolvedRef,
    query: SearchQuery,
    signal: AbortSignal,
    onMatches?: (matches: SearchMatch[]) => void
  ) {
    if (ref.kind === 'working') return searchFiles(ref.worktree, null, query, signal, onMatches);
    if (ref.kind === 'commit') return searchFiles(found.repoPath, ref.sha, query, signal, onMatches);
    const committed = await searchFiles(found.repoPath, ref.sha, query, signal);
    if (ref.owned.size === 0) return { ...committed, ref: WORKING_REF };
    return mergeOwnedMatches(committed, await searchFiles(ref.worktree, null, query, signal), ref.owned);
  }

  async function resolveOwnedDiff(
    found: CodeTask,
    base: string,
    ref: ResolvedRef & { kind: 'owned' },
    paths: string[] | null
  ) {
    const committed = await resolveCommitDiff(found.repoPath, base, ref.sha, undefined, paths);
    const owned = [...ref.owned].filter((path) => paths === null || paths.includes(path));
    if (owned.length === 0) return committed;
    const working = await resolveWorkingDiff(ref.worktree, base, owned);
    return [...committed.filter((file) => !ref.owned.has(file.path)), ...working].sort((a, b) =>
      a.path.localeCompare(b.path)
    );
  }

  function readDiffPaths(url: URL) {
    const path = url.searchParams.get('path');
    if (path === null) return null;
    const previous = url.searchParams.get('previous');
    return [...(previous ? [assertRepoPath(previous)] : []), assertRepoPath(path)];
  }

  async function resolveDiff(found: CodeTask, url: URL, signal: AbortSignal): Promise<TaskDiff> {
    const baseParam = url.searchParams.get('base');
    const headParam = url.searchParams.get('head');
    const paths = readDiffPaths(url);
    let refs: TaskRefs | null = null;
    if (!baseParam || !headParam) refs = await resolveRefs(found, signal);
    const base = await assertCommit(found.repoPath, baseParam || refs?.base || refs?.head || '', signal);
    const head = await resolveRef(
      found,
      headParam || (found.worktree || found.workspace ? WORKING_REF : (refs?.head ?? null)),
      signal
    );
    if (head.kind === 'working')
      return { base, head: WORKING_REF, files: await resolveWorkingDiff(head.worktree, base, paths, signal) };
    if (head.kind === 'owned')
      return { base, head: WORKING_REF, files: await resolveOwnedDiff(found, base, head, paths) };
    const files = await cache.read(
      `${found.repoPath}\0diff\0${base}\0${head.sha}\0${paths?.join('\0') ?? ''}`,
      () => resolveCommitDiff(found.repoPath, base, head.sha, signal, paths),
      (value) => value.reduce((sum, file) => sum + file.patch.length + file.path.length, 0)
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

  function respondSearchStream(found: CodeTask, request: Request, url: URL, query: SearchQuery) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (line: SearchLine) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        try {
          const ref = await resolveRef(found, url.searchParams.get('ref'), request.signal);
          const streamed = ref.kind !== 'owned';
          const result = await search(
            found,
            ref,
            query,
            request.signal,
            streamed ? (matches) => send({ kind: 'matches', matches }) : undefined
          );
          if (!streamed) send({ kind: 'matches', matches: result.matches });
          send({ kind: 'done', result: { ...result, matches: [] } });
        } catch (error) {
          const code = error instanceof DomainError ? error.code : 'search_failed';
          send({ kind: 'failed', code, message: describeError(error) });
        }
        controller.close();
      },
    });
    return Promise.resolve(
      new Response(stream, {
        headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
      })
    );
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
        'Cache-Control': isWorkingRef(ref) ? 'no-store' : IMMUTABLE,
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
      const query = readSearch(url);
      if (request.headers.get('accept')?.includes('application/x-ndjson'))
        return respondSearchStream(found, request, url, query);
      return respondWith(found, request, url, (ref) => search(found, ref, query, request.signal));
    }),
    route('diff', (found, request, url) => {
      const head = url.searchParams.get('head');
      const pinned = Boolean(url.searchParams.get('base') && head && head !== WORKING_REF);
      return respondCached(request, pinned, () => resolveDiff(found, url, request.signal));
    }),
  ];
}
