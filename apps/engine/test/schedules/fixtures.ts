import { join } from 'node:path';
import { listActiveRuns, type ScheduleTrigger } from '@shinsa/core';
import { Engine } from '../../src/runtime/index.ts';
import { SecretStore } from '../../src/secrets/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir } from '../helpers/index.ts';

export async function startTask(engine: Engine, repoId: string, dir: string, title: string) {
  const before = new Set(Object.keys(engine.state.tasks));
  await engine.dispatch({ type: 'task.create', request: title, repoId });
  const taskId = Object.keys(engine.state.tasks).find((id) => !before.has(id)) ?? '';
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title,
    repoId,
    size: 'small',
    branch: `feat/${taskId}`,
    waitsOn: [],
  });
  await engine.dispatch({ type: 'config.record', taskId, problems: [] });
  await engine.dispatch({ type: 'worktree.ready', taskId, path: dir, branch: `feat/${taskId}` });
  return { taskId, runId: listActiveRuns(engine.state, taskId)[0]?.id ?? '' };
}

export async function createWorld() {
  const dir = createTempDir('shinsa-schedules-');
  const engine = new Engine(new EventLog(join(dir, 'shinsa.sqlite')));
  await engine.dispatch({
    type: 'repo.register',
    repo: {
      name: 'app',
      path: dir,
      defaultBranch: 'main',
      remote: null,
      checkCommands: [],
    },
    projectName: null,
  });
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  const { taskId, runId } = await startTask(engine, repoId, dir, 'Watch the nightly builds');
  const secrets = new SecretStore(join(dir, 'secrets.json'));
  return { dir, engine, repoId, taskId, runId, secrets };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

export async function addSchedule(
  world: World,
  trigger: ScheduleTrigger,
  options: { text?: string; newTask?: boolean; maxRuns?: number | null } = {}
) {
  const events = await world.engine.dispatch({
    type: 'agent.set_schedule',
    runId: world.runId,
    scheduleId: null,
    name: 'Nightly',
    text: options.text ?? 'Check the nightly build.',
    trigger,
    target: options.newTask ? { kind: 'new_task', priority: 'normal', mode: 'build' } : null,
    source: null,
    enabled: null,
    maxRuns: options.maxRuns ?? null,
    timeZone: 'UTC',
  });
  const written = events.find((event) => event.type === 'schedule.written');
  if (!written) throw new Error('no schedule');
  return written.schedule;
}
