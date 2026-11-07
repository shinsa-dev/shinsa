import { Effect, Option } from 'effect';
import { selectServiceRunIn } from '../../apps/engine/src/terminals/runs.ts';
import { isTaskSettled } from '../../packages/core/src/index.ts';
import type { StartedMachine } from './machine.ts';
import {
  ORIGIN,
  PREVIEW_SHARE_POLL,
  PreviewPending,
  SANDBOX_PATH,
  SandboxFailed,
  SERVICE_TOGGLE,
  type ServicePreview,
  type SharedService,
  TEAMMATE_TOGGLE,
} from './schema.ts';
import { toggleTeammate } from './team.ts';

const startSharedService = Effect.fn('Sandbox.startSharedService')(function* (shared: SharedService) {
  const { engine, terminals, serviceId, taskId } = shared;
  const service = yield* terminals.findService(serviceId);
  const run = yield* selectServiceRunIn(yield* engine.core.state, service, taskId, terminals);
  if (Option.isNone(run))
    return yield* new SandboxFailed({ message: 'The shared web service cannot run in its task.' });
  yield* terminals.startService(serviceId, run.value);
});

export const createServicePreview = Effect.fn('Sandbox.createServicePreview')(function* (
  studio: StartedMachine
) {
  const { engine, terminals } = studio;
  const { services } = yield* terminals.snapshot;
  const task = Object.values((yield* engine.core.state).tasks).find(
    (entry) =>
      entry.repoId &&
      entry.worktreePath &&
      !isTaskSettled(entry) &&
      services.some((each) => each.projectId === entry.projectId && each.name === 'web')
  );
  const service = services.find((entry) => entry.projectId === task?.projectId && entry.name === 'web');
  if (!(task && service))
    return yield* new SandboxFailed({ message: 'No seeded task has a web service to share.' });
  const shared: SharedService = { engine, terminals, serviceId: service.id, taskId: task.id };
  yield* startSharedService(shared);
  yield* engine.core.dispatch({
    type: 'preview.share',
    taskId: task.id,
    serviceId: service.id,
    limit: 'none',
  });
  const readPreview = Effect.gen(function* () {
    const preview = (yield* engine.core.state).tasks[task.id]?.previews?.find(
      (entry) => entry.serviceId === service.id
    );
    const run = (yield* terminals.snapshot).terminals.find(
      (entry) => entry.serviceId === service.id && entry.taskId === task.id
    );
    if (preview?.url && run?.remoteUrl) {
      const ready: ServicePreview = {
        url: preview.url,
        privateUrl: run.remoteUrl,
        handle: task.handle ?? task.id,
        port: studio.machine.port,
      };
      return { preview: ready, shared };
    }
    if (preview?.failure)
      return yield* new SandboxFailed({ message: `Sharing the web service failed: ${preview.failure}` });
    return yield* new PreviewPending();
  });
  return yield* readPreview.pipe(
    Effect.retry(PREVIEW_SHARE_POLL),
    Effect.catchTag('PreviewPending', () =>
      Effect.fail(new SandboxFailed({ message: 'Sharing the web service did not finish.' }))
    )
  );
});

const toggleSharedService = Effect.fn('Sandbox.toggleSharedService')(function* (
  shared: SharedService,
  url: URL
) {
  if (url.pathname.endsWith('/start')) yield* startSharedService(shared);
  if (url.pathname.endsWith('/stop')) yield* shared.terminals.stopService(shared.serviceId, shared.taskId);
  return Response.redirect(`${ORIGIN}${SANDBOX_PATH}`, 303);
});

export function respondToggle(shared: SharedService, url: URL) {
  if (SERVICE_TOGGLE.test(url.pathname)) return toggleSharedService(shared, url);
  if (TEAMMATE_TOGGLE.test(url.pathname)) return Effect.sync(() => toggleTeammate(url));
  return null;
}
