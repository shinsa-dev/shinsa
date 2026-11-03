import { resolveServiceRunIn } from '../../apps/engine/src/terminals/routes.ts';
import { isTaskSettled } from '../../packages/core/src/index.ts';
import type { StartedMachine } from './machine.ts';
import {
  ORIGIN,
  SANDBOX_PATH,
  SERVICE_TOGGLE,
  type ServicePreview,
  type SharedService,
  TEAMMATE_TOGGLE,
} from './schema.ts';
import { toggleTeammate } from './team.ts';

function startSharedService(shared: SharedService) {
  const { engine, terminals, serviceId, taskId } = shared;
  const run = resolveServiceRunIn(engine.state, terminals.findService(serviceId), taskId, terminals);
  if (!run) throw new Error('The shared web service cannot run in its task.');
  terminals.startService(serviceId, run);
}

export async function createServicePreview(
  studio: StartedMachine
): Promise<{ preview: ServicePreview; shared: SharedService }> {
  const { engine, terminals } = studio;
  const { services } = terminals.snapshot();
  const task = Object.values(engine.state.tasks).find(
    (entry) =>
      entry.repoId &&
      entry.worktreePath &&
      !isTaskSettled(entry) &&
      services.some((each) => each.projectId === entry.projectId && each.name === 'web')
  );
  const service = services.find((entry) => entry.projectId === task?.projectId && entry.name === 'web');
  if (!(task && service)) throw new Error('No seeded task has a web service to share.');
  const shared: SharedService = { engine, terminals, serviceId: service.id, taskId: task.id };
  startSharedService(shared);
  await engine.dispatch({ type: 'preview.share', taskId: task.id, serviceId: service.id, limit: 'none' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const preview = engine.state.tasks[task.id]?.previews?.find((entry) => entry.serviceId === service.id);
    const run = terminals
      .snapshot()
      .terminals.find((entry) => entry.serviceId === service.id && entry.taskId === task.id);
    if (preview?.url && run?.remoteUrl)
      return {
        preview: {
          url: preview.url,
          privateUrl: run.remoteUrl,
          handle: task.handle ?? task.id,
          port: studio.machine.port,
        },
        shared,
      };
    if (preview?.failure) throw new Error(`Sharing the web service failed: ${preview.failure}`);
    await Bun.sleep(100);
  }
  throw new Error('Sharing the web service did not finish.');
}

async function toggleSharedService(shared: SharedService, url: URL) {
  if (url.pathname.endsWith('/start')) startSharedService(shared);
  if (url.pathname.endsWith('/stop')) await shared.terminals.stopService(shared.serviceId, shared.taskId);
  return Response.redirect(`${ORIGIN}${SANDBOX_PATH}`, 303);
}

export function respondToggle(shared: SharedService, url: URL) {
  if (SERVICE_TOGGLE.test(url.pathname)) return toggleSharedService(shared, url);
  if (TEAMMATE_TOGGLE.test(url.pathname)) return toggleTeammate(url);
  return null;
}
