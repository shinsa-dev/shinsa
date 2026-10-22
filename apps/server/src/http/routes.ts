import { DomainError, resolveQueueSummary, type ShinsaEvent, type UserCommand } from '@shinsa/core';
import type { ModelCatalog } from '../agents/models/index.ts';
import type { ServerConfig } from '../config/index.ts';
import { resolveTaskDiff } from '../git/index.ts';
import { describeError } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { type CommandResult, runCommand } from '../shell/index.ts';
import type { EvidenceStore } from '../store/index.ts';
import { resolveInside } from './paths.ts';

export type Launcher = (command: string[], cwd: string) => Promise<CommandResult>;

export interface ApiContext {
  engine: Engine;
  config: ServerConfig;
  evidence: EvidenceStore;
  models: ModelCatalog;
  launch?: Launcher;
}

interface ApiRoute {
  method: 'GET' | 'POST';
  pattern: RegExp;
  respond: (match: RegExpExecArray, request: Request) => Promise<Response>;
}

type OpenTarget = 'editor' | 'finder' | 'terminal';

export const MAX_FILE_BYTES = 2_000_000;

const USER_COMMANDS = new Set<UserCommand['type']>([
  'repo.update',
  'area.write',
  'area.remove',
  'focus.change',
  'settings.change',
  'task.create',
  'task.prioritize',
  'task.block',
  'task.cancel',
  'task.complete',
  'task.retry',
  'task.message',
  'gate.answer',
]);

const OPEN_TARGETS = new Set<OpenTarget>(['editor', 'finder', 'terminal']);

function respondJson(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export function respondError(code: string, message: string, status: number) {
  return respondJson({ error: { code, message } }, status);
}

export function respondFailure(error: unknown, status = 400) {
  const code = error instanceof DomainError ? error.code : 'request_failed';
  return respondError(code, describeError(error), status);
}

function parseUserCommand(body: unknown): UserCommand {
  const type = body && typeof body === 'object' ? (body as { type?: unknown }).type : undefined;
  if (!USER_COMMANDS.has(type as UserCommand['type']))
    throw new DomainError('command_forbidden', 'Unknown command.');
  return body as UserCommand;
}

function selectCreatedTaskId(events: ShinsaEvent[]) {
  for (const event of events) if (event.type === 'task.created') return event.taskId;
  return null;
}

export async function dispatchUserCommand(engine: Engine, body: unknown) {
  return selectCreatedTaskId(await engine.dispatch(parseUserCommand(body)));
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError('body_invalid', 'The request body is not valid JSON.');
  }
}

function readOpenRequest(body: unknown) {
  const { target, path, line } = (body ?? {}) as { target?: unknown; path?: unknown; line?: unknown };
  if (!OPEN_TARGETS.has(target as OpenTarget))
    throw new DomainError('target_invalid', 'Open it in the editor, Finder or Terminal.');
  return {
    target: target as OpenTarget,
    path: typeof path === 'string' && path ? path : null,
    line: typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : null,
  };
}

export function createApiRoutes(context: ApiContext) {
  const { engine, config, evidence, models } = context;
  const launch = context.launch ?? runCommand;

  function selectWorktreeTask(taskId: string) {
    const task = engine.state.tasks[taskId];
    const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
    if (!task?.worktreePath || !repo) return null;
    return { task, repo, worktreePath: task.worktreePath };
  }

  async function respondDiff(taskId: string) {
    const found = selectWorktreeTask(taskId);
    if (!found) return respondError('diff_unavailable', 'No worktree.', 404);
    const base = found.task.baseTaskId ? engine.state.tasks[found.task.baseTaskId] : undefined;
    const baseBranch = base?.branch && base.stage !== 'merged' ? base.branch : null;
    return respondJson(await resolveTaskDiff(found.repo, found.worktreePath, baseBranch));
  }

  function resolveOpenCommand(target: OpenTarget, worktreePath: string, location: string | null) {
    const editor = config.editor ?? (Bun.which('cursor') ? 'cursor' : 'code');
    if (target === 'editor')
      return location ? [editor, worktreePath, '--goto', location] : [editor, worktreePath];
    if (target === 'terminal') return ['open', '-a', config.terminal, worktreePath];
    return ['open', worktreePath];
  }

  async function respondOpen(taskId: string, request: Request) {
    const found = selectWorktreeTask(taskId);
    if (!found) return respondError('worktree_missing', 'No worktree.', 404);
    const { target, path, line } = readOpenRequest(await readJson(request));
    const file = path ? resolveInside(found.worktreePath, path) : null;
    const location = file && line ? `${file}:${line}` : file;
    const result = await launch(resolveOpenCommand(target, found.worktreePath, location), found.worktreePath);
    return respondJson({ ok: result.ok });
  }

  async function respondFile(taskId: string, url: URL) {
    const found = selectWorktreeTask(taskId);
    if (!found) return respondError('worktree_missing', 'No worktree.', 404);
    const requested = url.searchParams.get('path') ?? '';
    const path = resolveInside(found.worktreePath, requested);
    if (!path) return respondError('path_invalid', 'Outside the worktree.', 400);
    const file = Bun.file(path);
    if (!(await file.exists())) return respondJson({ path: requested, content: null });
    if (file.size > MAX_FILE_BYTES)
      return respondError('file_too_large', 'The file is too large to show.', 400);
    return respondJson({ path: requested, content: await file.text() });
  }

  async function respondCommand(request: Request) {
    const taskId = await dispatchUserCommand(engine, await readJson(request));
    return respondJson({ ok: true, taskId });
  }

  function respondEvidence(name: string) {
    const path = evidence.selectFile(name);
    if (!path) return Promise.resolve(new Response('Not found', { status: 404 }));
    return Promise.resolve(new Response(Bun.file(path)));
  }

  const routes: ApiRoute[] = [
    { method: 'GET', pattern: /^\/api\/tasks\/([^/]+)\/diff$/, respond: ([, id = '']) => respondDiff(id) },
    {
      method: 'POST',
      pattern: /^\/api\/tasks\/([^/]+)\/open$/,
      respond: ([, id = ''], request) => respondOpen(id, request),
    },
    {
      method: 'GET',
      pattern: /^\/api\/tasks\/([^/]+)\/file$/,
      respond: ([, id = ''], request) => respondFile(id, new URL(request.url)),
    },
    { method: 'GET', pattern: /^\/api\/models$/, respond: async () => respondJson(await models.list()) },
    { method: 'POST', pattern: /^\/api\/commands$/, respond: (_match, request) => respondCommand(request) },
    {
      method: 'GET',
      pattern: /^\/api\/queue$/,
      respond: (_match, request) =>
        Promise.resolve(
          respondJson(resolveQueueSummary(engine.state, Date.now(), new URL(request.url).origin))
        ),
    },
    {
      method: 'GET',
      pattern: /^\/api\/evidence\/([^/]+)$/,
      respond: ([, name = '']) => respondEvidence(name),
    },
  ];

  return function handleApi(request: Request, url: URL): Promise<Response> {
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (match && route.method === request.method) return route.respond(match, request);
    }
    return Promise.resolve(respondError('not_found', 'No such endpoint.', 404));
  };
}
