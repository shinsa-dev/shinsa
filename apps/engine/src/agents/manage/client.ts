import { parseUserCommand, type ShinsaEvent, type UserCommand } from '@shinsa/core';
import { createSurfaceClient } from '../../cli/api.ts';
import type { ProjectChanges } from '../../projects/routes.ts';
import type { DispatchOptions, Engine } from '../../runtime/engine.ts';
import type { SurfaceClient } from '../../surface/index.ts';

export type CommandRouter = (command: UserCommand, options: DispatchOptions) => Promise<ShinsaEvent[]>;

export interface ManageAccess {
  baseUrl: () => string;
  projects: ProjectChanges;
  route: CommandRouter;
}

interface ManageClientOptions {
  engine: Engine;
  base: string;
  key: string | null;
  byTask: string;
  projects?: ProjectChanges;
  route?: CommandRouter;
}

export function createManageClient(options: ManageClientOptions): SurfaceClient {
  const { engine, base, key, byTask, projects } = options;
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
    send: async (command) => {
      sent += 1;
      const events = await route(parseUserCommand(command), {
        ...(key === null ? {} : { id: `${key}:${sent}` }),
        ...from,
      });
      const created = events.find((event) => event.type === 'task.created');
      return { ok: true, taskId: created?.type === 'task.created' ? created.taskId : null };
    },
  };
}
