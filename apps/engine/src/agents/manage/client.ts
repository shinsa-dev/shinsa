import { DomainError, parseUserCommand, type ShinsaEvent, type UserCommand } from '@shinsa/core';
import { Effect } from 'effect';
import { createSurfaceClient } from '../../cli/api.ts';
import { describeError } from '../../log/index.ts';
import type { ProjectChanges } from '../../projects/changes.ts';
import { edgeRuntime } from '../../runtime/edge.ts';
import type { DispatchOptions, Engine } from '../../runtime/engine.ts';
import type { SurfaceClient, SurfaceHookSecrets } from '../../surface/index.ts';
import { ToolCallFailed } from '../tools/schema.ts';

export type CommandRouter = (command: UserCommand, options: DispatchOptions) => Promise<ShinsaEvent[]>;

export interface ManageAccess {
  baseUrl: () => string;
  projects: ProjectChanges;
  route: CommandRouter;
  hookSecrets?: (taskId: string) => SurfaceHookSecrets;
}

interface ManageClientOptions {
  engine: Engine;
  base: string;
  key: string | null;
  byTask: string;
  projects?: ProjectChanges;
  route?: CommandRouter;
  hookSecrets?: SurfaceHookSecrets;
}

export function createManageClient(options: ManageClientOptions): SurfaceClient {
  const { engine, base, key, byTask, projects, hookSecrets } = options;
  const route = options.route ?? ((command, dispatchOptions) => engine.dispatch(command, dispatchOptions));
  const from = { onBehalf: true, byTask };
  let sent = 0;
  return {
    ...createSurfaceClient(base, key ?? ''),
    ...(projects
      ? {
          projects: {
            upsertRepo: (projectId, path) => projects.upsertRepo(projectId, path, from),
            upsertFolder: (projectId, path) => projects.upsertFolder(projectId, path, from),
          },
        }
      : {}),
    ...(hookSecrets ? { hookSecrets } : {}),
    send: (command) => {
      sent += 1;
      const id = key === null ? {} : { id: `${key}:${sent}` };
      return edgeRuntime.runPromise(
        Effect.gen(function* () {
          const parsed = yield* Effect.fromResult(parseUserCommand(command));
          const events = yield* Effect.tryPromise({
            try: () => route(parsed, { ...id, ...from }),
            catch: (error) =>
              error instanceof DomainError ? error : new ToolCallFailed({ message: describeError(error) }),
          });
          const created = events.find((event) => event.type === 'task.created');
          const written = events.find((event) => event.type === 'schedule.written');
          return {
            ok: true as const,
            taskId: created?.type === 'task.created' ? created.taskId : null,
            ...(written?.type === 'schedule.written' ? { scheduleId: written.schedule.id } : {}),
          };
        })
      );
    },
  };
}
