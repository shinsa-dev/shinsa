import { expect } from 'bun:test';
import {
  NO_PROJECT_KEY,
  PROJECT_KEY_PATTERN,
  parseTaskHandle,
  type ShinsaCommand,
  type ShinsaState,
} from '../../src/index.ts';
import { isTriaged } from '../../src/state/queries.ts';

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

const PROJECT_ODDS = 0.2;

const NAMES = ['Superwall', 'Basket', 'Notes'];

const KEYS = [undefined, undefined, 'SW', 'BAS', 'SWL', 'bad key'];

const FOLDERS = [[], [], ['/code'], ['/elsewhere']];

function listProjectIds(state: ShinsaState) {
  return Object.keys(state.projects);
}

function writeProject(state: ShinsaState, random: Random): ShinsaCommand {
  const existing = pick(random, [undefined, ...listProjectIds(state)]);
  const project = existing ? state.projects[existing] : undefined;
  const key = pick(random, KEYS);
  const folders = pick(random, FOLDERS);
  return {
    type: 'project.write',
    project: {
      ...(existing ? { id: existing } : {}),
      name: project?.name ?? pick(random, NAMES) ?? 'Superwall',
      color: 'blue',
      ...(key ? { key } : {}),
      ...(folders ? { folders } : {}),
    },
  };
}

function createTask(state: ShinsaState, random: Random): ShinsaCommand {
  const projectId = pick(random, [undefined, null, ...listProjectIds(state)]);
  return {
    type: 'task.create',
    request: 'Do something in a project',
    repoId: pick(random, [null, 'repo']) ?? null,
    ...(projectId === undefined ? {} : { projectId }),
  };
}

export function selectProjectCommand(state: ShinsaState, random: Random, now: number): ShinsaCommand | null {
  if (random() >= PROJECT_ODDS) return null;
  const projectId = pick(random, [null, ...listProjectIds(state)]) ?? null;
  const commands: ShinsaCommand[] = [
    writeProject(state, random),
    writeProject(state, random),
    { type: 'focus.change', projectId, until: pick(random, [null, now + 60_000]) ?? null },
    createTask(state, random),
    createTask(state, random),
  ];
  if (projectId) commands.push({ type: 'project.remove', projectId });
  return pick(random, commands) ?? null;
}

export function assertHandleInvariants(state: ShinsaState) {
  const seen = new Map<string, string>();
  for (const task of Object.values(state.tasks)) {
    const context = `${task.id} at ${task.stage}`;
    if (isTriaged(task)) expect(task.handle, `${context}: triaged without a handle`).toBeTruthy();
    if (!task.handle) continue;
    const owner = seen.get(task.handle);
    if (owner) throw new Error(`${context}: handle ${task.handle} is also ${owner}'s`);
    seen.set(task.handle, task.id);
    expect(parseTaskHandle(task.handle), context).toBe(task.handle);
    const [key = '', number = '0'] = task.handle.split('-');
    expect(key === NO_PROJECT_KEY || PROJECT_KEY_PATTERN.test(key), `${context}: key ${key}`).toBe(true);
    expect(state.taskNumbers[key] ?? 0, `${context}: counter of ${key}`).toBeGreaterThanOrEqual(
      Number(number)
    );
  }
}

export function listProjectMarks(state: ShinsaState) {
  const tasks = Object.values(state.tasks);
  const keyOf = (handle: string | null | undefined) => handle?.split('-')[0];
  return [
    tasks.some((task) => keyOf(task.handle) === NO_PROJECT_KEY) ? 'task without a project' : null,
    tasks.some((task) => task.projectId && keyOf(task.handle) === state.projects[task.projectId]?.key)
      ? 'task in a project'
      : null,
    tasks.some(
      (task) =>
        task.projectId &&
        state.projects[task.projectId] &&
        keyOf(task.handle) !== state.projects[task.projectId]?.key
    )
      ? 'handle under an earlier key'
      : null,
    tasks.some((task) => task.projectId && !state.projects[task.projectId])
      ? 'task of a removed project'
      : null,
    state.focus.projectId ? 'project in focus' : null,
  ];
}
