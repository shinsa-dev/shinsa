import {
  createState,
  type Evidence,
  type Gate,
  type Project,
  type Repo,
  type Run,
  type ShinsaState,
  type Task,
} from '@shinsa/core';

export const NOW = Date.UTC(2026, 9, 22, 14, 0);

export function createTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    request: `Do ${overrides.id}`,
    title: `Task ${overrides.id}`,
    repoId: null,
    size: null,
    planFirst: false,
    stage: 'building',
    stageReason: 'building the change',
    priority: 'normal',
    branch: null,
    worktreePath: null,
    plan: null,
    phases: [],
    planAnswers: null,
    summary: null,
    report: null,
    findings: [],
    reviewSummary: null,
    fixRounds: 0,
    fixFor: null,
    fixSignature: null,
    stalledFixes: 0,
    recoveries: 0,
    phaseReports: [],
    checkResults: null,
    pullRequest: null,
    waitsOn: [],
    note: null,
    origin: null,
    createdAt: NOW - 60_000,
    updatedAt: NOW - 30_000,
    stageChangedAt: NOW - 30_000,
    activity: [],
    auto: { shape: false, start: false, priority: false },
    ...overrides,
  };
}

export function createGate(overrides: Partial<Gate> & { id: string; taskId: string }): Gate {
  return {
    type: 'review',
    status: 'open',
    title: 'Review the changes',
    body: '',
    runId: null,
    openedAt: NOW - 10_000,
    answeredAt: null,
    decision: null,
    response: null,
    ...overrides,
  };
}

export function createRun(overrides: Partial<Run> & { id: string; taskId: string }): Run {
  return {
    role: 'agent',
    provider: 'claude',
    model: null,
    sessionId: null,
    startedAt: NOW - 20_000,
    endedAt: null,
    outcome: null,
    summary: null,
    ...overrides,
  };
}

export function createRepo(overrides: Partial<Repo> & { id: string }): Repo {
  return {
    name: overrides.id,
    path: `/Users/you/Developer/${overrides.id}`,
    defaultBranch: 'main',
    remote: null,
    projectId: null,
    checkCommands: [],
    ...overrides,
  };
}

export function createProject(overrides: Partial<Project> & { id: string }): Project {
  return {
    name: overrides.id,
    color: 'blue',
    key: overrides.id.slice(0, 2).toUpperCase(),
    description: '',
    folders: [],
    ...overrides,
  };
}

export function createEvidence(overrides: Partial<Evidence> & { id: string; taskId: string }): Evidence {
  return {
    runId: null,
    kind: 'screenshot',
    title: `Evidence ${overrides.id}`,
    uri: `/api/evidence/${overrides.id}.png`,
    attachedAt: NOW - 5_000,
    ...overrides,
  };
}

function byId<T extends { id: string }>(items: T[] = []) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export function createShinsaState(parts: {
  tasks?: Task[];
  gates?: Gate[];
  runs?: Run[];
  repos?: Repo[];
  projects?: Project[];
  evidence?: Evidence[];
  patch?: Partial<ShinsaState>;
}): ShinsaState {
  return {
    ...createState(),
    tasks: byId(parts.tasks),
    gates: byId(parts.gates),
    runs: byId(parts.runs),
    repos: byId(parts.repos),
    projects: byId(parts.projects),
    evidence: byId(parts.evidence),
    ...parts.patch,
  };
}
