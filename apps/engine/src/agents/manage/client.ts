import { DomainError, parseUserCommand, type ShinsaEvent, type UserCommand } from '@shinsa/core';
import { RequestFailedWire } from '@shinsa/core/engine-api/errors';
import { Context, Effect, Schema } from 'effect';
import { createSurfaceClient } from '../../cli/api.ts';
import { describeError } from '../../log/index.ts';
import type { ProjectChanges } from '../../projects/changes.ts';
import type { DispatchOptions } from '../../runtime/engine/schema.ts';
import type { EngineCore } from '../../runtime/engine/service.ts';
import { SurfaceCallFailed, type SurfaceClient, type SurfaceHookSecrets } from '../../surface/index.ts';
import type { RouteFailure } from '../../triage/index.ts';

export type CommandRouter = (
  command: UserCommand,
  options: DispatchOptions
) => Effect.Effect<ShinsaEvent[], RouteFailure>;

export type TeammateRelay = (instanceId: string, request: Request) => Effect.Effect<Response>;

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

const RELAY_ORIGIN = 'http://teammate.local';

const readRelayFailure = Effect.fn('ManageClient.readRelayFailure')(function* (response: Response) {
  const text = yield* Effect.promise(() => response.text());
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(RequestFailedWire))(text);
  const message =
    decoded._tag === 'Some' ? decoded.value.message : `The teammate’s machine answered ${response.status}.`;
  const code = decoded._tag === 'Some' ? decoded.value.code : 'relay_failed';
  return new DomainError({ code, message });
});

function createRelay(engine: EngineCore['Service'], byTask: string, relay: TeammateRelay) {
  return Effect.fn('ManageClient.relay')(function* (instanceId: string, command: UserCommand) {
    const task = (yield* engine.state).tasks[byTask];
    const from = task ? { fromTeammateTask: { handle: task.handle ?? null, title: task.title } } : {};
    const request = new Request(`${RELAY_ORIGIN}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...command, ...from }),
    });
    const response = yield* relay(instanceId, request);
    if (!response.ok) return yield* Effect.fail(yield* readRelayFailure(response));
  });
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
    ...(options.relay ? { relay: createRelay(engine, byTask, options.relay) } : {}),
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
