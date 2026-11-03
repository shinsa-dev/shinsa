import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CODE_LIMITS, resolveEditRefusal, selectTaskByReference } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import {
  EditConflict,
  RequestFailed,
  RouteNotFound,
  ROUTE_NOT_FOUND_MESSAGE,
  WorktreeMissing,
} from '@shinsa/core/engine-api/schema';
import { Effect, Predicate, Schema } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { assertRepoPath, resolveInside, resolveWritableInside } from '../../../files/paths.ts';
import { runCommand, runCommandOrThrow } from '../../../shell/index.ts';
import { requestPromise, requestSync } from '../../failures.ts';
import { BODY_INVALID } from '../../schema.ts';
import { HttpServices } from '../../services/service.ts';
import { findTaskByRef } from '../../task-lookup.ts';
import {
  isTaskListed,
  matchesTaskQuery,
  resolveChatPage,
  resolveTaskDetail,
  resolveTaskView,
} from '../../task-views.ts';
import {
  AFTER_FAILURE,
  ChatIndex,
  ChatKinds,
  CODE_TO_EDIT_MISSING,
  DEFAULT_CHAT_KINDS,
  DEFAULT_FILTER,
  DEFAULT_LIMIT,
  EDIT_SIZE_FAILURE,
  KINDS_FAILURE,
  LIMIT_FAILURE,
  ListLimit,
  MAX_LIMIT,
  PATH_LEAVES_WORKTREE,
  STATUS_FAILURE,
  TaskFilter,
  WORKTREE_MISSING_MESSAGE,
} from './schema.ts';

export const TasksHandlers = HttpApiBuilder.group(
  EngineApi,
  'tasks',
  Effect.fn('TasksHandlers')(function* (handlers) {
    const { engine, config, transcripts, workspaces, launch = runCommand } = yield* HttpServices;
    const decodeFilter = Schema.decodeUnknownEffect(TaskFilter);
    const decodeLimit = Schema.decodeUnknownEffect(ListLimit);
    const decodeKinds = Schema.decodeUnknownEffect(ChatKinds);
    const decodeIndex = Schema.decodeUnknownEffect(ChatIndex);

    const readLimit = (raw: string | undefined) =>
      raw === undefined
        ? Effect.succeed(DEFAULT_LIMIT)
        : decodeLimit(raw).pipe(
            Effect.map((limit) => Math.min(limit, MAX_LIMIT)),
            Effect.mapError(() => new RequestFailed(LIMIT_FAILURE))
          );

    const readKinds = (raw: string | undefined) =>
      raw
        ? decodeKinds(raw.split(',').map((kind) => kind.trim())).pipe(
            Effect.mapError(() => new RequestFailed(KINDS_FAILURE))
          )
        : Effect.succeed(DEFAULT_CHAT_KINDS);

    const readIndex = (raw: string | undefined) =>
      raw === undefined
        ? Effect.succeed(null)
        : decodeIndex(raw).pipe(Effect.mapError(() => new RequestFailed(AFTER_FAILURE)));

    const readText = Effect.fn('TasksHandlers.readText')(function* (value: unknown, name: string) {
      if (!Predicate.isString(value))
        return yield* new RequestFailed({ code: BODY_INVALID, message: `${name} must be text.` });
      if (new TextEncoder().encode(value).length > CODE_LIMITS.blobBytes)
        return yield* new RequestFailed(EDIT_SIZE_FAILURE);
      return value;
    });

    const resolveOpenCommand = (target: string, worktreePath: string, location: string | null) => {
      const editor = config.editor ?? (Bun.which('cursor') ? 'cursor' : 'code');
      if (target === 'editor')
        return location ? [editor, worktreePath, '--goto', location] : [editor, worktreePath];
      if (target === 'terminal') return ['open', '-a', config.terminal, worktreePath];
      return ['open', worktreePath];
    };

    return handlers
      .handle(
        'list',
        Effect.fn('TasksHandlers.list')(function* ({ query, request }) {
          const state = engine.state;
          const filter = yield* decodeFilter(query.status ?? DEFAULT_FILTER).pipe(
            Effect.mapError(() => new RequestFailed(STATUS_FAILURE))
          );
          const limit = yield* readLimit(query.limit);
          const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
          const base = new URL(request.originalUrl).origin;
          const tasks = Object.values(state.tasks)
            .filter((task) => isTaskListed(state, task, filter) && matchesTaskQuery(state, task, words))
            .filter(
              (task) =>
                !query.repo ||
                task.repoId === query.repo ||
                state.repos[task.repoId ?? '']?.name === query.repo
            )
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, limit)
            .map((task) => resolveTaskView(state, task, base));
          return { tasks };
        })
      )
      .handle('read', ({ params, request }) =>
        Effect.map(findTaskByRef(engine.state, params.taskRef), (task) =>
          resolveTaskDetail(engine.state, task, new URL(request.originalUrl).origin)
        )
      )
      .handle(
        'chat',
        Effect.fn('TasksHandlers.chat')(function* ({ params, query }) {
          const task = yield* findTaskByRef(engine.state, params.taskRef);
          const kinds = new Set(yield* readKinds(query.kinds));
          const limit = yield* readLimit(query.limit);
          const after = yield* readIndex(query.after);
          return resolveChatPage(transcripts, engine.state, task, {
            runId: query.run ?? null,
            kinds,
            limit,
            after,
          });
        })
      )
      .handle(
        'open',
        Effect.fn('TasksHandlers.open')(function* ({ params, payload }) {
          const task = selectTaskByReference(engine.state, params.taskRef);
          const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
          const worktreePath = task?.worktreePath;
          if (!worktreePath || !repo)
            return yield* new WorktreeMissing({ message: WORKTREE_MISSING_MESSAGE });
          const file = payload.path ? resolveInside(worktreePath, payload.path) : null;
          const location = file && payload.line ? `${file}:${payload.line}` : file;
          const command = resolveOpenCommand(payload.target, worktreePath, location);
          const result = yield* requestPromise(() => launch(command, worktreePath));
          return { ok: result.ok };
        })
      )
      .handle(
        'writeFile',
        Effect.fn('TasksHandlers.writeFile')(function* ({ params, payload }) {
          if (!workspaces) return yield* new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });
          const task = selectTaskByReference(engine.state, params.taskRef);
          const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
          if (!task || !repo)
            return yield* new RequestFailed({ code: 'code_unavailable', message: CODE_TO_EDIT_MISSING });
          const refusal = resolveEditRefusal(task);
          const root = task.worktreePath;
          if (refusal || !root)
            return yield* new RequestFailed({ code: 'edit_refused', message: refusal ?? '' });
          const path = yield* requestSync(() =>
            assertRepoPath(Predicate.isString(payload.path) ? payload.path : null)
          );
          const content = yield* readText(payload.content, 'content');
          const base = payload.base === null ? null : yield* readText(payload.base, 'base');
          const absolute = resolveWritableInside(root, path);
          if (!absolute)
            return yield* new RequestFailed({ code: 'path_invalid', message: PATH_LEAVES_WORKTREE });
          const disk: { current: string | null; written: boolean } = { current: null, written: false };
          yield* requestPromise(() =>
            workspaces.resolve(task).writeEdit(repo, task, path, () => {
              disk.current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
              if (disk.current !== base) return false;
              mkdirSync(dirname(absolute), { recursive: true });
              writeFileSync(absolute, content);
              disk.written = true;
              return true;
            })
          );
          if (!disk.written)
            return yield* new EditConflict({
              message: `${path} changed on disk since the editor read it.`,
              content: disk.current,
            });
          const status = yield* requestPromise(() =>
            runCommandOrThrow(['git', 'status', '--porcelain=v1', '-z', '--', path], root, {
              env: { GIT_LITERAL_PATHSPECS: '1' },
            })
          );
          const changed = status.length > 0;
          const key = Bun.hash(`${base ?? ''}\0${content}`).toString(36);
          yield* requestPromise(() =>
            engine.dispatch(
              { type: 'task.record_edit', taskId: task.id, path, changed },
              { id: `edit:${task.id}:${path}:${key}` }
            )
          );
          return { path, changed };
        })
      );
  })
);
