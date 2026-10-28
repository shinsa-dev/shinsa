import { expect } from 'bun:test';
import {
  isDecisionGate,
  isTaskClosed,
  isTaskSettled,
  listActiveRuns,
  listLiveRuns,
  listOpenGates,
  listStackedPullRequests,
  type MessageKind,
  needsWorktree,
  type PipelineStep,
  type PullRequest,
  resolveCurrentRound,
  resolveTaskPipeline,
  resolveTaskRounds,
  type ShinsaCommand,
  type ShinsaState,
  type Task,
} from '../../src/index.ts';

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function chance(random: Random, odds: number) {
  return random() < odds;
}

const KINDS: MessageKind[] = ['new_round', 'new_round', 'new_round', 'feedback', 'separate_task'];

const SHAPES = [undefined, undefined, 'change', 'fix', 'answer', 'operation'] as const;

let pullRequestNumber = 100;

function readPullRequest(task: Task, random: Random): PullRequest {
  if (!task.pullRequest) pullRequestNumber += 1;
  const current = task.pullRequest?.number ?? pullRequestNumber;
  return {
    number: current,
    url: `https://github.com/o/r/pull/${current}`,
    state: 'open',
    checks: chance(random, 0.9) ? 'passing' : 'failing',
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: 0,
  };
}

const PLAN = {
  goal: 'Ship the round.',
  phases: [{ title: 'Do it', detail: 'All of it, verified.' }],
  behaviour: [],
  approach: '',
  files: [],
  outOfScope: [],
  verification: [{ label: 'Round tests', command: 'bun test src/round', phases: [1] }],
  questions: [],
  impact: 'Touches nothing else; undo by reverting.',
  operation: ['Run it and check the result.'],
};

function listLaterRoundCommands(state: ShinsaState): ShinsaCommand[] {
  const later = new Set(
    Object.values(state.tasks)
      .filter((task) => resolveCurrentRound(task).number > 1)
      .map((task) => task.id)
  );
  const runs = listActiveRuns(state).flatMap((run): ShinsaCommand[] => {
    if (!later.has(run.taskId) || run.delegation) return [];
    if (run.purpose === 'plan') {
      const task = state.tasks[run.taskId];
      const builds = task ? resolveTaskPipeline(task).includes('build') : false;
      return [
        {
          type: 'agent.propose_plan',
          runId: run.id,
          document: builds ? PLAN : { ...PLAN, verification: [] },
        },
      ];
    }
    if (run.purpose === 'build') {
      return [
        { type: 'agent.complete_phase', runId: run.id, summary: 'Done.', spots: [], judgementCalls: [] },
      ];
    }
    if (run.role === 'reviewer')
      return [{ type: 'agent.report_review', runId: run.id, summary: null, findings: [] }];
    return [];
  });
  const gates = listOpenGates(state).flatMap((gate): ShinsaCommand[] => {
    if (!later.has(gate.taskId) || !isDecisionGate(gate)) return [];
    return [{ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null }];
  });
  const checks = Object.values(state.tasks)
    .filter((task) => later.has(task.id) && task.stage === 'checking')
    .map((task): ShinsaCommand => ({ type: 'checks.record', taskId: task.id, results: [] }));
  return [...runs, ...gates, ...checks];
}

function listProgressCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const later = listLaterRoundCommands(state);
  if (later.length > 0 && chance(random, 0.5)) return later;
  return Object.values(state.tasks).flatMap((task): ShinsaCommand[] => {
    if (task.stage === 'triage' && task.size !== null && task.stageReason === 'verifying the setup') {
      return [{ type: 'config.record', taskId: task.id, problems: [] }];
    }
    if (task.stage === 'triage' && task.branch) {
      return [{ type: 'worktree.ready', taskId: task.id, path: `/wt/${task.id}`, branch: task.branch }];
    }
    if (task.stage !== 'shipping' && task.stage !== 'awaiting_merge') return [];
    const merging = task.stage === 'awaiting_merge' && listOpenGates(state, task.id).length === 0;
    const pullRequest = readPullRequest(task, random);
    return [
      {
        type: 'pull_request.record',
        taskId: task.id,
        pullRequest: merging && chance(random, 0.8) ? { ...pullRequest, state: 'merged' } : pullRequest,
      },
    ];
  });
}

function listMessageCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const takes = Object.values(state.tasks).filter((candidate) => !isTaskClosed(candidate));
  const task = pick(random, takes);
  if (!task) return [];
  const shape = pick(random, SHAPES);
  const commands: ShinsaCommand[] = [
    {
      type: 'task.message',
      taskId: task.id,
      text: 'Also make it faster.',
      kind: pick(random, KINDS) ?? 'new_round',
      ...(shape ? { shape } : {}),
      ...(chance(random, 0.5) ? { title: 'Make it faster', why: 'It came up.' } : {}),
    },
  ];
  for (const round of resolveTaskRounds(task)) {
    if (round.status !== 'waiting' && round.status !== 'active') continue;
    commands.push({
      type: 'round.ship',
      taskId: task.id,
      number: round.number,
      shipping: chance(random, 0.5) ? 'stacked' : 'onto_pull_request',
    });
  }
  for (const suggestion of task.suggestions ?? []) {
    if (suggestion.status !== 'open' || !suggestion.splitOff) continue;
    commands.push({ type: 'suggestion.keep', taskId: task.id, suggestionId: suggestion.id });
  }
  if (isTaskSettled(task)) commands.push({ type: 'task.complete', taskId: task.id });
  return commands;
}

const LATER_COMPOSITIONS: PipelineStep[][] = [
  [
    'investigate',
    'your_ok',
    'plan',
    'build',
    'checks',
    'agent_review',
    'your_review',
    'pull_request',
    'merge',
  ],
  ['research', 'your_ok', 'plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'],
  ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge', 'operate'],
];

function listLaterTaskIds(state: ShinsaState) {
  return new Set(
    Object.values(state.tasks)
      .filter((task) => resolveCurrentRound(task).number > 1)
      .map((task) => task.id)
  );
}

export function listLaterChangeAnswers(state: ShinsaState, random: Random): ShinsaCommand[] {
  const later = listLaterTaskIds(state);
  return listOpenGates(state).flatMap((gate): ShinsaCommand[] => {
    if (!later.has(gate.taskId) || gate.type !== 'proposal') return [];
    const decision = chance(random, 0.7) ? 'reject' : 'approve';
    return [{ type: 'gate.answer', gateId: gate.id, decision, response: null }];
  });
}

function listLaterComposingCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const later = listLaterTaskIds(state);
  return listActiveRuns(state).flatMap((run): ShinsaCommand[] => {
    if (!later.has(run.taskId) || run.delegation) return [];
    if (run.purpose === 'plan') {
      const steps = pick(random, LATER_COMPOSITIONS) ?? [];
      return [{ type: 'agent.reshape', runId: run.id, steps, reason: 'Find it first.' }];
    }
    if (run.role === 'investigator' || run.role === 'researcher') {
      const step = run.role === 'investigator' ? 'investigate' : 'research';
      return [{ type: 'agent.deliver', runId: run.id, step, body: 'Found it.' }];
    }
    return [];
  });
}

export function listComposedRoundCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const composing = listLaterComposingCommands(state, random);
  if (composing.length > 0 && chance(random, 0.6)) return composing;
  return listRoundCommands(state, random);
}

export function listRoundCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  if (chance(random, 0.5)) return listProgressCommands(state, random);
  return listMessageCommands(state, random);
}

function assertRoundShape(task: Task, context: string) {
  const rounds = resolveTaskRounds(task);
  expect(
    rounds.map((round) => round.number),
    `${context}: rounds are numbered one by one`
  ).toEqual(rounds.map((_, index) => index + 1));
  const active = rounds.filter((round) => round.status === 'active');
  expect(active.length, `${context}: one active round at a time`).toBeLessThanOrEqual(1);
  if (!isTaskSettled(task)) expect(active, `${context}: an open task works on one round`).toHaveLength(1);
  const started = rounds.filter((round) => round.startedAt !== null).map((round) => round.number);
  for (const round of rounds.filter((candidate) => candidate.startedAt === null)) {
    expect(round.number, `${context}: a queued round comes after every started one`).toBeGreaterThan(
      Math.max(...started)
    );
  }
  if (isTaskClosed(task)) {
    expect(
      rounds.filter((round) => round.status === 'waiting'),
      `${context}: a closed task has no round waiting`
    ).toEqual([]);
  }
}

function assertStepsBelong(state: ShinsaState, task: Task, context: string) {
  const current = resolveCurrentRound(task).number;
  for (const run of listLiveRuns(state, task.id)) {
    expect(run.round ?? 1, `${context}: run ${run.id} of another round`).toBe(current);
  }
  for (const gate of listOpenGates(state, task.id).filter((open) => open.type !== 'post_merge')) {
    expect(gate.round ?? 1, `${context}: gate ${gate.id} of another round`).toBe(current);
  }
}

function assertPullRequests(task: Task, context: string) {
  const rounds = resolveTaskRounds(task);
  const active = rounds.find((round) => round.status === 'active');
  if (active?.branch && needsWorktree(resolveTaskPipeline(task))) {
    expect(task.branch, `${context}: the task works on its round's branch`).toBe(active.branch);
  }
  if (active && task.pullRequest) {
    expect(active.pullRequest?.number, `${context}: the round ships through the task's pull request`).toBe(
      task.pullRequest.number
    );
  }
  if (isTaskSettled(task)) {
    expect(
      rounds.filter((round) => round.status === 'shipped').map((round) => round.number),
      `${context}: a settled task leaves a pull request open with no merge gate`
    ).toEqual([]);
  }
  for (const round of rounds) {
    if (round.status === 'shipped') {
      expect(
        round.pullRequest?.state,
        `${context}: round ${round.number} shipped without an open pull request`
      ).toBe('open');
    }
    if (round.status === 'merged' && round.pullRequest) {
      expect(round.pullRequest.state, `${context}: round ${round.number} merged`).toBe('merged');
    }
    if (round.base && round.status !== 'waiting') {
      expect(
        rounds.some((earlier) => earlier.number < round.number && earlier.branch === round.base),
        `${context}: round ${round.number} stacks on a branch no earlier round had`
      ).toBe(true);
    }
  }
  const branches = new Map<number, string | null>();
  for (const round of rounds) {
    const pullRequest = round.pullRequest;
    if (pullRequest?.state !== 'open' || round.status === 'waiting') continue;
    const known = branches.get(pullRequest.number);
    if (known !== undefined && round.status === 'shipped') {
      expect(round.branch, `${context}: pull request #${pullRequest.number} on two branches`).toBe(known);
    }
    branches.set(pullRequest.number, round.branch);
  }
  for (const stacked of listStackedPullRequests(task)) {
    expect(stacked.state, context).toBe('open');
    expect(stacked.number, `${context}: the stack repeats the open pull request`).not.toBe(
      task.pullRequest?.number
    );
  }
}

export function assertRoundInvariants(state: ShinsaState, task: Task, context: string) {
  assertRoundShape(task, context);
  assertStepsBelong(state, task, context);
  assertPullRequests(task, context);
}

export function listRoundMarks(state: ShinsaState) {
  return Object.values(state.tasks).flatMap((task) => {
    const rounds = resolveTaskRounds(task);
    return [
      rounds.length >= 3 ? 'three rounds' : null,
      rounds.some((round) => round.number > 1 && round.status === 'merged') ? 'merged later round' : null,
      rounds.some((round) => round.status === 'shipped') ? 'shipped round' : null,
      rounds.some((round) => round.base !== null && round.status !== 'waiting') ? 'stacked round' : null,
      rounds.filter((round) => round.pullRequest?.number !== undefined).length >= 2 &&
      new Set(rounds.map((round) => round.pullRequest?.number).filter(Boolean)).size === 1
        ? 'rounds onto one pull request'
        : null,
      rounds.some((round) => round.number > 1 && round.status !== 'waiting' && round.base === null)
        ? 'round from the default branch'
        : null,
      task.suggestions?.some((suggestion) => suggestion.keptRound !== undefined) ? 'kept split-off' : null,
      isTaskClosed(task) && task.stage === 'done' ? 'closed task' : null,
      rounds.some((round) => round.status === 'waiting') ? 'waiting round' : null,
    ];
  });
}
