import { DomainError, parseUserCommand, type ShinsaEvent, type UserCommand } from '@shinsa/core';
import { Context, Effect } from 'effect';
import { createSurfaceClient } from '../../cli/api.ts';
import { describeError } from '../../log/index.ts';
import type { ProjectChanges } from '../../projects/changes.ts';
import type { DispatchOptions } from '../../runtime/engine/schema.ts';
import type { EngineCore } from '../../runtime/engine/service.ts';
import { SurfaceCallFailed, type SurfaceClient, type SurfaceHookSecrets } from '../../surface/index.ts';
import { createCommandRelay, createLocalRelay, type TeammateRelay } from '../../surface/relay.ts';
import type { RouteFailure } from '../../triage/index.ts';

export type CommandRouter = (
  command: UserCommand,
  options: DispatchOptions
) => Effect.Effect<ShinsaEvent[], RouteFailure>;

export type { TeammateRelay } from '../../surface/relay.ts';

export class ManageAccess extends Context.Service<
  ManageAccess,
  {
    readonly baseUrl: () => string;
    readonly projects: ProjectChanges['Service'];
    readonly route: CommandRouter;
    readonly hookSecrets?: (taskId: string) => SurfaceHookSecrets;
    readonly relay?: TeammateRelay;
  }
>()('shinsa/engine/agents/manage/ManageAccess') {}

interface ManageClientOptions {
  engine: EngineCore['Service'];
  base: string;
  key: string | null;
  byTask: string;
  projects?: ProjectChanges['Service'];
  route?: CommandRouter;
  hookSecrets?: SurfaceHookSecrets;
  relay?: TeammateRelay;
}

function createRelay(engine: EngineCore['Service'], byTask: string, relay: TeammateRelay) {
  const sender = Effect.map(engine.state, (state) => {
    const task = state.tasks[byTask];
    return task ? { fromTeammateTask: { handle: task.handle ?? null, title: task.title } } : {};
  });
  return createCommandRelay(relay, sender);
}

function refuse(error: unknown) {
  return error instanceof DomainError ? error : new SurfaceCallFailed({ message: describeError(error) });
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
            upsertRepo: (projectId, path) =>
              Effect.mapError(projects.upsertRepo(projectId, path, from), refuse),
            upsertFolder: (projectId, path) =>
              Effect.mapError(projects.upsertFolder(projectId, path, from), refuse),
          },
        }
      : {}),
    ...(hookSecrets ? { hookSecrets } : {}),
    relay: createRelay(engine, byTask, options.relay ?? createLocalRelay(base)),
    send: Effect.fn('ManageClient.send')(function* (command) {
      sent += 1;
      const id = key === null ? {} : { id: `${key}:${sent}` };
      const parsed = yield* Effect.fromResult(parseUserCommand(command));
      const events = yield* route(parsed, { ...id, ...from }).pipe(Effect.mapError(refuse));
      const created = events.find((event) => event.type === 'task.created');
      const written = events.find((event) => event.type === 'schedule.written');
      return {
        ok: true as const,
        taskId: created?.type === 'task.created' ? created.taskId : null,
        ...(written?.type === 'schedule.written' ? { scheduleId: written.schedule.id } : {}),
      };
    }),
  };
}
