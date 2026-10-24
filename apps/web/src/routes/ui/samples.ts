import {
  createState,
  type Gate,
  type PipelineStep,
  type Round,
  type Run,
  type Schedule,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';

export const MINUTE = 60_000;

export const HOUR = 60 * MINUTE;

export const DAY = 24 * HOUR;

export function acknowledgeSample() {
  toast('Nothing was sent. This page only shows samples.');
  return Promise.resolve(true);
}

export function createSampleTask(
  now: number,
  overrides: Partial<Task> & { id: string; title: string }
): Task {
  return {
    request: overrides.title,
    repoId: null,
    size: null,
    planFirst: false,
    auto: { shape: false, start: false, priority: false },
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
    createdAt: now - 3 * HOUR,
    updatedAt: now - 20 * MINUTE,
    stageChangedAt: now - 20 * MINUTE,
    activity: [],
    ...overrides,
  };
}

export function createSampleGate(
  now: number,
  overrides: Partial<Gate> & { id: string; taskId: string; title: string }
): Gate {
  return {
    type: 'failure',
    status: 'open',
    body: '',
    runId: null,
    openedAt: now - 12 * MINUTE,
    answeredAt: null,
    decision: null,
    response: null,
    ...overrides,
  };
}

export function createSampleRun(now: number, overrides: Partial<Run> & { id: string; taskId: string }): Run {
  return {
    role: 'builder',
    status: 'running',
    provider: 'claude',
    model: null,
    sessionId: null,
    startedAt: now - 9 * MINUTE,
    endedAt: null,
    outcome: null,
    summary: null,
    ...overrides,
  };
}

function byId<T extends { id: string }>(items: T[]) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export function createSampleState(parts: {
  tasks: Task[];
  gates?: Gate[];
  runs?: Run[];
  schedules?: Schedule[];
  taskBudgetUsd?: number;
  taskUsageLimit?: number;
}): ShinsaState {
  const state = createState();
  return {
    ...state,
    settings: {
      ...state.settings,
      taskBudgetUsd: parts.taskBudgetUsd ?? null,
      taskUsageLimit: parts.taskUsageLimit ?? null,
    },
    tasks: byId(parts.tasks),
    gates: byId(parts.gates ?? []),
    runs: byId(parts.runs ?? []),
    schedules: byId(parts.schedules ?? []),
  };
}

export function createSampleSchedule(
  now: number,
  overrides: Partial<Schedule> & { id: string; name: string }
): Schedule {
  return {
    text: 'Check the nightly build and fix what broke.',
    trigger: { kind: 'interval', everyMinutes: 60 },
    target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
    timeZone: 'UTC',
    enabled: true,
    nextRunAt: now + 40 * MINUTE,
    runCount: 3,
    maxRuns: null,
    runs: [],
    createdAt: now - 3 * 24 * HOUR,
    updatedAt: now - HOUR,
    createdBy: { kind: 'you' },
    lastTaskId: null,
    lastRunId: null,
    stopped: null,
    replayKeys: {},
    ...overrides,
  };
}

const SAMPLE_PULL_REQUEST = {
  number: 4531,
  url: 'https://github.com/superwall/paywall-next/pull/4531',
  state: 'open' as const,
  checks: 'passing' as const,
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: 0,
};

const ROUND_PIPELINE: PipelineStep[] = [
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
];

function createSampleRound(
  now: number,
  overrides: Partial<Round> & { number: number; title: string }
): Round {
  return {
    request: overrides.title,
    why: null,
    shipping: 'onto_pull_request',
    status: 'shipped',
    pipeline: ROUND_PIPELINE,
    branch: 'feat/mcp-v2',
    base: null,
    pullRequest: { number: 4531, url: SAMPLE_PULL_REQUEST.url, state: 'open', base: 'main' },
    queuedAt: now - 7_200_000,
    startedAt: now - 7_200_000,
    endedAt: now - 3_600_000,
    outcome: null,
    ...overrides,
  };
}

export function createSampleRoundsTask(now: number): Task {
  return createSampleTask(now, {
    id: 'sample-rounds',
    handle: 'SW-14',
    title: 'Move the embedded chat to MCP v2',
    stage: 'planning',
    stageReason: 'planning the phases',
    pullRequest: SAMPLE_PULL_REQUEST,
    rounds: [
      createSampleRound(now, {
        number: 1,
        title: 'Move the embedded chat to MCP v2',
        outcome: {
          goal: 'Talk to the editor over MCP v2.',
          phases: ['Swap the client', 'Port the tools'],
          headline: 'The embedded chat talks MCP v2 and keeps every tool.',
          result: null,
        },
      }),
      createSampleRound(now, {
        number: 2,
        title: 'Stream tool results into the chat',
        request: 'Also stream the tool results instead of waiting for the whole answer.',
        outcome: {
          goal: 'Stream tool results.',
          phases: ['Stream the results'],
          headline: 'Tool results stream as they arrive.',
          result: null,
        },
      }),
      createSampleRound(now, {
        number: 3,
        title: 'Cache the server list',
        request: 'Cache the server list so the picker opens at once.',
        status: 'active',
        endedAt: null,
      }),
      createSampleRound(now, {
        number: 4,
        title: 'Add a settings screen for MCP servers',
        request: 'Then add a settings screen for the MCP servers.',
        status: 'waiting',
        startedAt: null,
        endedAt: null,
        pullRequest: null,
      }),
    ],
  });
}
