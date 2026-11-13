import {
  type Project,
  type Repo,
  type ShinsaEventInput,
  createSettings,
  formatTaskHandle,
  NO_PROJECT_KEY,
} from '../../packages/core/src/index.ts';
import { DAY, HOUR } from '../kit/time.ts';
import { listSeedEvidenceEvents } from './evidence.ts';
import { pushSeedFeedback } from './feedback.ts';
import { NOW, type SeedTask } from './kit.ts';
import { pushSeedMemory } from './memory.ts';
import { type Timeline, pushTask } from './timeline.ts';

export function buildEvents(tasks: SeedTask[], projects: Project[], repos: Repo[]) {
  const timeline: Timeline = [];
  const push = (at: number, event: ShinsaEventInput) => timeline.push({ at, event });
  const start = NOW - 10 * DAY;
  for (const project of projects) push(start, { type: 'project.written', project });
  for (const repo of repos) push(start, { type: 'repo.registered', repo });
  pushSeedMemory(start, push);

  push(start, {
    type: 'settings.changed',
    settings: {
      ...createSettings(),
      taskUsageLimit: 10,
      autoPace: true,
      agentModels: { agent: 'auto', reviewer: 'auto', answerer: 'auto' },
    },
  });
  push(NOW - HOUR, { type: 'usage.pace_recorded', provider: 'claude', pace: 45 });
  push(NOW - HOUR, {
    type: 'usage.models_recorded',
    models: [
      { family: 'fable', usable: true, left: 38, accounts: [] },
      { family: 'opus', usable: true, left: 61, accounts: [] },
      { family: 'sonnet', usable: true, left: 80, accounts: [] },
    ],
  });
  for (const task of tasks) pushTask(task, push);
  pushSeedFeedback(push);
  const runEnds = new Map(
    timeline.flatMap(({ at, event }) => (event.type === 'run.ended' ? [[event.runId, at] as const] : []))
  );
  for (const { at, event } of listSeedEvidenceEvents(runEnds)) push(at, event);
  return stampTaskHandles(
    timeline.sort((a, b) => a.at - b.at),
    projects,
    repos
  );
}

function stampTaskHandles(timeline: Timeline, projects: Project[], repos: Repo[]): Timeline {
  const counts = new Map<string, number>();
  const stamped = new Set<string>();
  const resolveHandle = (repoId: string | null) => {
    const projectId = repos.find((repo) => repo.id === repoId)?.projectId ?? null;
    const key = projects.find((project) => project.id === projectId)?.key;
    const counted = projectId && key ? key : NO_PROJECT_KEY;
    const number = (counts.get(counted) ?? 0) + 1;
    counts.set(counted, number);
    return { projectId: projectId && key ? projectId : null, handle: formatTaskHandle(counted, number) };
  };
  const homes = new Set<string>();
  return timeline.map(({ at, event }) => {
    if (event.type === 'task.created' && event.watchHome) homes.add(event.taskId);
    if (homes.has('taskId' in event ? String(event.taskId) : '')) return { at, event };
    if (event.type === 'task.created') {
      const projectId = repos.find((repo) => repo.id === event.repoId)?.projectId ?? null;
      if (!projectId || !projects.some((project) => project.id === projectId)) return { at, event };
      stamped.add(event.taskId);
      return { at, event: { ...event, ...resolveHandle(event.repoId) } };
    }
    if (event.type !== 'task.triaged' || stamped.has(event.taskId)) return { at, event };
    stamped.add(event.taskId);
    return { at, event: { ...event, ...resolveHandle(event.repoId) } };
  });
}
