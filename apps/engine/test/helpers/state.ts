import {
  type Briefing,
  createState,
  type Gate,
  type Repo,
  type Round,
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
    projectId: null,
    name: 'app',
    path: '/code/app',
    defaultBranch: 'main',
    remote: 'github.com/acme/app',
    checkCommands: [],
    ...overrides,
  } as Repo;
}

export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Fix the tab scroll',
    request: 'Fix the tab scroll',
    repoId: 'repo-1',
    stage: 'building',
    stageReason: '',
    branch: 'fix/tab-scroll',
    worktreePath: '/wt/task-1',
    waitsOn: [],
    pullRequest: null,
    phaseReports: [],
    plan: null,
    fixFor: null,
    priority: 'normal',
    summary: null,
    origin: null,
    planFirst: false,
    auto: { shape: false, start: false, priority: false },
    updatedAt: 1,
    createdAt: 1,
    ...overrides,
  } as unknown as Task;
}

export function createRound(overrides: Partial<Round> = {}): Round {
  return {
    number: 1,
    title: 'Fix the tab scroll',
    request: 'Fix the tab scroll',
    why: null,
    shipping: 'stacked',
    status: 'shipped',
    pipeline: [],
    branch: 'fix/tab-scroll',
    base: null,
    pullRequest: null,
    queuedAt: 1,
    startedAt: 1,
    endedAt: null,
    outcome: null,
    ...overrides,
  };
}

export function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    taskId: 'task-1',
    role: 'agent',
    purpose: 'build',
    status: 'running',
    prompt: 'Build phase 1',
    provider: 'claude',
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
    type: 'question',
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
  commandIds: (string | null)[];
  reject: (predicate: (command: ShinsaCommand) => boolean, error?: Error) => void;
  respond: (predicate: (command: ShinsaCommand) => boolean, events: ShinsaEvent[]) => void;
  update: (patch: (state: ShinsaState) => void) => void;
  notify: () => void;
  briefed: StubBriefing[];
  refuseBriefing: (predicate: () => boolean) => void;
}

interface StubBriefing {
  projectId: string | null;
  text: string;
  briefing: Briefing;
}

export function createStubEngine(patch: (state: ShinsaState) => void = () => undefined): StubEngine {
  const state = createState();
  patch(state);
  const dispatched: ShinsaCommand[] = [];
  const commandIds: (string | null)[] = [];
  const rejections: { predicate: (command: ShinsaCommand) => boolean; error: Error }[] = [];
  const responses: { predicate: (command: ShinsaCommand) => boolean; events: ShinsaEvent[] }[] = [];
  const listeners = new Set<(state: ShinsaState) => void>();
  const briefed: StubBriefing[] = [];
  const briefingRefusals: (() => boolean)[] = [];
  const stub = {
    state,
    subscribe: (listener: (state: ShinsaState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: (command: ShinsaCommand, options: { id?: string } = {}): Promise<ShinsaEvent[]> => {
      dispatched.push(command);
      commandIds.push(options.id ?? null);
      const rejection = rejections.find((candidate) => candidate.predicate(command));
      if (rejection) return Promise.reject(rejection.error);
      const response = responses.find((candidate) => candidate.predicate(command));
      return Promise.resolve(response?.events ?? []);
    },
    writeBriefing: (projectId: string | null, written: { text: string; briefing: Briefing }) => {
      briefed.push({ projectId, ...written });
      if (briefingRefusals.some((refused) => refused())) return Promise.reject(new Error('rejected'));
      return Promise.resolve();
    },
  };
  return {
    engine: stub as unknown as Engine,
    state,
    dispatched,
    commandIds,
    reject: (predicate, error = new Error('rejected')) => rejections.push({ predicate, error }),
    respond: (predicate, events) => responses.push({ predicate, events }),
    update: (change) => change(state),
    notify: () => {
      for (const listener of listeners) listener(state);
    },
    briefed,
    refuseBriefing: (predicate) => briefingRefusals.push(predicate),
  };
}
