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
import { Effect, FileSystem, Layer, Option, Predicate, Schema } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Transcripts } from '../../../agents/transcripts/service.ts';
import { EngineConfig } from '../../../config/service.ts';
import { selectInside, selectWritableInside } from '../../../files/inside.ts';
import { parseRepoPath } from '../../../files/paths.ts';
import { selectOnPath } from '../../../files/probe.ts';
import { GitCommands } from '../../../git/layers.ts';
import { Git } from '../../../git/service.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { runCommand } from '../../../shell/command.ts';
import { ShellLayer } from '../../../shell/layers.ts';
import { Workspaces } from '../../../workspaces/service.ts';
import { requestResult, resolveRequestFailure } from '../../failures.ts';
import { BODY_INVALID } from '../../schema.ts';
import { CommandLauncher } from '../../schema.ts';
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
    const engine = yield* EngineCore;
    const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
    const config = yield* EngineConfig;
    const transcripts = yield* Transcripts;
    const workspaces = Option.getOrUndefined(yield* Effect.serviceOption(Workspaces));
    const launch = yield* CommandLauncher;
    const open =
      launch ??
      ((command: string[], cwd: string) => runCommand(command, cwd).pipe(Effect.provide(ShellLayer)));
    const git = yield* Git;
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

    const resolveOpenCommand = Effect.fn('TasksHandlers.resolveOpenCommand')(function* (
      target: string,
      worktreePath: string,
      location: string | null
    ) {
      const cursor = yield* withFiles(selectOnPath('cursor', Bun.env.PATH ?? ''));
      const editor = config.editor ?? (Option.isSome(cursor) ? 'cursor' : 'code');
      if (target === 'editor')
        return location ? [editor, worktreePath, '--goto', location] : [editor, worktreePath];
      if (target === 'terminal') return ['open', '-a', config.terminal, worktreePath];
      return ['open', worktreePath];
    });

    return handlers
      .handle(
        'list',
        Effect.fn('TasksHandlers.list')(function* ({ query, request }) {
          const state = yield* engine.state;
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
        Effect.flatMap(engine.state, (state) =>
          Effect.map(findTaskByRef(state, params.taskRef), (task) =>
            resolveTaskDetail(state, task, new URL(request.originalUrl).origin)
          )
        )
      )
      .handle(
        'chat',
        Effect.fn('TasksHandlers.chat')(function* ({ params, query }) {
          const task = yield* findTaskByRef(yield* engine.state, params.taskRef);
          const kinds = new Set(yield* readKinds(query.kinds));
          const limit = yield* readLimit(query.limit);
          const after = yield* readIndex(query.after);
          const read = Object.values((yield* engine.state).runs).filter(
            (run) => run.taskId === task.id && (!query.run || run.id === query.run)
          );
          const entries = yield* Effect.forEach(read, (run) =>
            Effect.map(transcripts.listEntries(run.id), (listed) => [run.id, listed] as const)
          );
          return resolveChatPage(new Map(entries), yield* engine.state, task, {
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
          const task = selectTaskByReference(yield* engine.state, params.taskRef);
          const repo = task?.repoId ? (yield* engine.state).repos[task.repoId] : undefined;
          const worktreePath = task?.worktreePath;
          if (!worktreePath || !repo)
            return yield* new WorktreeMissing({ message: WORKTREE_MISSING_MESSAGE });
          const file = Option.getOrNull(yield* withFiles(selectInside(worktreePath, payload.path ?? '')));
          const location = file && payload.line ? `${file}:${payload.line}` : file;
          const command = yield* resolveOpenCommand(payload.target, worktreePath, location);
          const result = yield* open(command, worktreePath);
          return { ok: result.ok };
        })
      )
      .handle(
        'writeFile',
        Effect.fn('TasksHandlers.writeFile')(function* ({ params, payload }) {
          if (!workspaces) return yield* new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });
          const task = selectTaskByReference(yield* engine.state, params.taskRef);
          const repo = task?.repoId ? (yield* engine.state).repos[task.repoId] : undefined;
          if (!task || !repo)
            return yield* new RequestFailed({ code: 'code_unavailable', message: CODE_TO_EDIT_MISSING });
          const refusal = resolveEditRefusal(task);
          const root = task.worktreePath;
          if (Option.isSome(refusal) || !root)
            return yield* new RequestFailed({
              code: 'edit_refused',
              message: Option.getOrUndefined(refusal) ?? '',
            });
          const path = yield* requestResult(
            parseRepoPath(Predicate.isString(payload.path) ? payload.path : null)
          );
          const content = yield* readText(payload.content, 'content');
          const base = payload.base === null ? null : yield* readText(payload.base, 'base');
          const writable = yield* withFiles(selectWritableInside(root, path));
          if (Option.isNone(writable))
            return yield* new RequestFailed({ code: 'path_invalid', message: PATH_LEAVES_WORKTREE });
          const absolute = writable.value;
          const disk: { current: string | null; written: boolean } = { current: null, written: false };
          yield* workspaces
            .writeEdit(
              repo,
              task,
              path,
              withFiles(
                Effect.gen(function* () {
                  const fs = yield* FileSystem.FileSystem;
                  disk.current = (yield* fs.exists(absolute)) ? yield* fs.readFileString(absolute) : null;
                  if (disk.current !== base) return false;
                  yield* fs.makeDirectory(dirname(absolute), { recursive: true });
                  yield* fs.writeFileString(absolute, content);
                  disk.written = true;
                  return true;
                })
              )
            )
            .pipe(Effect.mapError(resolveRequestFailure));
          if (!disk.written)
            return yield* new EditConflict({
              message: `${path} changed on disk since the editor read it.`,
              content: disk.current,
            });
          const status = yield* git
            .run(['status', '--porcelain=v1', '-z', '--', path], root, {
              env: { GIT_LITERAL_PATHSPECS: '1' },
            })
            .pipe(Effect.mapError(resolveRequestFailure));
          const changed = status.length > 0;
          const key = Bun.hash(`${base ?? ''}\0${content}`).toString(36);
          yield* Effect.mapError(
            engine.dispatch(
              { type: 'task.record_edit', taskId: task.id, path, changed },
              { id: `edit:${task.id}:${path}:${key}` }
            ),
            resolveRequestFailure
          );
          return { path, changed };
        })
      );
  })
).pipe(Layer.provide(GitCommands));
