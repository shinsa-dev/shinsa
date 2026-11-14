import {
  AUTOPILOT_READINESS_TRACK,
  type AutopilotAgreement,
  type AutopilotDecision,
  type AutopilotProfile,
  type AutopilotReadinessKind,
  EMPTY_AUTOPILOT_PROFILE,
  type AutopilotTally,
  createState,
  type Evidence,
  type Gate,
  type Initiative,
  type Project,
  type Repo,
  recordAutopilotDecisions,
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
    auto: { shape: false, start: false, priority: false, project: false },
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

export function createAutopilotKindsProfile(
  kinds: Partial<
    Record<AutopilotReadinessKind, Pick<AutopilotAgreement, 'scored' | 'agreed'> & { base: number }>
  >
): AutopilotProfile {
  const entries = Object.entries(kinds).map(([kind, { scored, agreed, base }]) => {
    const track = AUTOPILOT_READINESS_TRACK[kind as AutopilotReadinessKind];
    const agreement = {
      scored,
      agreed,
      weight: scored,
      agreedWeight: agreed,
      baseWeight: base * scored,
      loss: 0,
    };
    return [
      kind,
      {
        tracks: { ...EMPTY_AUTOPILOT_PROFILE.tracks, [track]: agreement },
        rate: EMPTY_AUTOPILOT_PROFILE.rates.gate,
      },
    ];
  });
  return { ...EMPTY_AUTOPILOT_PROFILE, kinds: Object.fromEntries(entries) };
}

export function createAutopilotAreasProfile(
  areas: Record<string, Pick<AutopilotAgreement, 'scored' | 'agreed'> & { base: number }>
): AutopilotProfile {
  const entries = Object.entries(areas).map(([area, { scored, agreed, base }]) => {
    const combined = {
      scored,
      agreed,
      weight: scored,
      agreedWeight: agreed,
      baseWeight: base * scored,
      loss: 0,
    };
    return [
      area,
      {
        tracks: { ...EMPTY_AUTOPILOT_PROFILE.tracks, combined },
        rate: EMPTY_AUTOPILOT_PROFILE.rates.gate,
      },
    ];
  });
  return { ...EMPTY_AUTOPILOT_PROFILE, areas: Object.fromEntries(entries) };
}

export function createAutopilotProfile(parts: {
  agreed: number;
  disagreed: number;
  unscored?: number;
  tallies?: Pick<AutopilotTally, 'kind' | 'total'>[];
}): AutopilotProfile {
  const sure = { head: 'gate' as const, p: 0.95, confidence: 0.8, similar: 40 };
  const doubtful = { ...sure, p: 0.2 };
  const decision = (
    answer: AutopilotDecision['answer'],
    guess: AutopilotDecision['guess'],
    modelGuess = guess === 'forward' ? doubtful : sure
  ) => ({
    at: NOW,
    taskId: 'task-1',
    gateId: null,
    kind: 'review' as const,
    answer,
    projectId: null,
    risk: null,
    scope: null,
    urgent: false,
    watchdog: false,
    touched: false,
    guess,
    followUp: null,
    note: null,
    facts: null,
    estimate: guess === null ? null : modelGuess,
    modelGuess,
  });
  const decisions = [
    ...Array.from({ length: parts.disagreed }, () => decision('revised', 'act')),
    ...Array.from({ length: parts.agreed }, (_, index) =>
      index % 3 === 0 ? decision('revised', 'forward') : decision('approved', 'act')
    ),
    ...Array.from({ length: parts.unscored ?? 0 }, () => decision('approved', null)),
  ];
  return {
    ...recordAutopilotDecisions(undefined, decisions),
    tallies: (parts.tallies ?? []).map((tally) => ({
      ...tally,
      key: tally.kind,
      projectId: null,
      risk: null,
      answers: {},
      recent: {},
      at: NOW,
    })),
  };
}

export function createInitiative(overrides: Partial<Initiative> & { id: string }): Initiative {
  return {
    name: `Initiative ${overrides.id}`,
    description: '',
    phases: [],
    leadTaskId: null,
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    ...overrides,
  };
}

export function createShinsaState(parts: {
  tasks?: Task[];
  gates?: Gate[];
  runs?: Run[];
  repos?: Repo[];
  projects?: Project[];
  evidence?: Evidence[];
  initiatives?: Initiative[];
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
    initiatives: byId(parts.initiatives),
    ...parts.patch,
  };
}
