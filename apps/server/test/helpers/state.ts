import {
  createState,
  type Gate,
  type Repo,
  type Run,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import type { Engine } from '../../src/runtime/index.ts';

export function createRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    areaId: null,
    name: 'app',
    path: '/code/app',
    defaultBranch: 'main',
    remote: 'github.com/acme/app',
    checkCommands: [],
    previewCommand: null,
    ...overrides,
  } as Repo;
}

export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Fix the tab scroll',
    intent: 'Fix the tab scroll',
    repoId: 'repo-1',
    stage: 'building',
    stageReason: '',
    branch: 'fix/tab-scroll',
    worktreePath: '/wt/task-1',
    baseTaskId: null,
    blockedBy: [],
    pullRequest: null,
    phaseReports: [],
    spec: null,
    fixFor: null,
    priority: 'normal',
    summary: null,
    origin: null,
    specFirst: false,
    updatedAt: 1,
    createdAt: 1,
    ...overrides,
  } as unknown as Task;
}

export function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    taskId: 'task-1',
    role: 'builder',
    status: 'running',
    prompt: 'Build phase 1',
    model: null,
    sessionId: null,
    phaseIndex: 0,
    startedAt: 1,
    endedAt: null,
    outcome: null,
    summary: null,
    ...overrides,
  } as unknown as Run;
}

export function createGate(overrides: Partial<Gate> = {}): Gate {
  return {
    id: 'gate-1',
    taskId: 'task-1',
    runId: 'run-1',
    kind: 'question',
    purpose: 'agent_question',
    status: 'open',
    title: 'Which colour?',
    body: null,
    decision: null,
    response: null,
    openedAt: 1,
    ...overrides,
  } as unknown as Gate;
}

export interface StubEngine {
  engine: Engine;
  state: ShinsaState;
  dispatched: ShinsaCommand[];
  reject: (predicate: (command: ShinsaCommand) => boolean, error?: Error) => void;
  update: (patch: (state: ShinsaState) => void) => void;
}

export function createStubEngine(patch: (state: ShinsaState) => void = () => undefined): StubEngine {
  const state = createState();
  patch(state);
  const dispatched: ShinsaCommand[] = [];
  const rejections: { predicate: (command: ShinsaCommand) => boolean; error: Error }[] = [];
  const stub = {
    state,
    dispatch: (command: ShinsaCommand): Promise<ShinsaEvent[]> => {
      dispatched.push(command);
      const rejection = rejections.find((candidate) => candidate.predicate(command));
      if (rejection) return Promise.reject(rejection.error);
      return Promise.resolve([]);
    },
  };
  return {
    engine: stub as unknown as Engine,
    state,
    dispatched,
    reject: (predicate, error = new Error('rejected')) => rejections.push({ predicate, error }),
    update: (change) => change(state),
  };
}
