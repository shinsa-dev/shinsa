import type { PipelineStep, Repo, RoundShipping, RunRole, PlanDocument } from '../packages/core/src/index.ts';
import type { Push, SeedClock, SeedTask } from './seed-kit.ts';

const TASK = 'task-mcp-rounds';
const BRANCH = 'feat/mcp-v2-agent';
const PIPELINE: PipelineStep[] = [
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
];

interface RoundScript {
  title: string;
  request: string;
  spec: PlanDocument;
  shipping?: RoundShipping;
}

function spec(goal: string, phases: [string, string][]): PlanDocument {
  return {
    goal,
    plan: phases.map(([title, detail]) => ({ title, detail })),
    behaviour: [],
    approach: goal,
    files: [],
    outOfScope: [],
    verification: ['bun test'],
    questions: [],
  };
}

const ROUNDS: RoundScript[] = [
  {
    title: 'Move the dashboard agent to MCP v2',
    request: 'the dashboard agent should talk MCP v2 instead of the old tool bridge',
    spec: spec('The dashboard agent runs every tool through an MCP v2 session instead of the old bridge.', [
      ['Open an MCP v2 session', 'One session per chat, opened on the first message.'],
      ['Route tool calls through it', 'The bridge stays only for the paywall preview.'],
    ]),
  },
  {
    title: 'Stream tool results into the chat',
    request: 'Also stream tool results into the chat as they arrive, not at the end.',
    spec: spec('Tool results appear in the chat while the tool runs.', [
      ['Stream partial results', 'Forward each MCP progress notification to the chat.'],
      ['Show them as they arrive', 'The chat appends each part under the tool row.'],
    ]),
  },
  {
    title: 'Reconnect a dropped MCP session',
    request:
      'When the MCP session drops, reconnect and replay the last tool call instead of failing the chat.',
    spec: spec('A dropped session reconnects up to three times and replays the call it lost.', [
      ['Reconnect with backoff', 'Three attempts, one, two and four seconds apart.'],
      ['Replay the lost call', 'The call in flight is sent again once the session is back.'],
    ]),
  },
  {
    title: 'Record tool call telemetry',
    request: 'Next: record how long each tool call takes and whether it failed, per app.',
    spec: spec('Every tool call is timed and recorded per app, with its outcome.', [
      ['Time each call', 'Wrap the session’s call in a timer.'],
      ['Write the events', 'One telemetry event per call, keyed by app.'],
    ]),
  },
  {
    title: 'Cache tool schemas between chats',
    request: 'Cache the tool list between chats so a new chat does not wait for it.',
    shipping: 'stacked',
    spec: spec('A new chat reuses the tool list the last one fetched, for up to an hour.', [
      ['Cache the tool list', 'Keyed by server URL, kept for an hour.'],
      ['Refresh it in the background', 'A stale list is used at once and refreshed behind it.'],
    ]),
  },
];

function run(
  push: Push,
  clock: SeedClock,
  [index, round]: [number, number],
  role: RunRole,
  minutes: number,
  summary: string | null
) {
  const runId = `${TASK}-run-${index}`;
  push(clock.step(0.5), {
    type: 'run.started',
    run: {
      id: runId,
      taskId: TASK,
      role,
      provider: 'claude',
      model: role === 'reviewer' ? 'claude-sonnet-5-5' : 'claude-opus-5-5',
      sessionId: `session-${role}`,
      startedAt: clock.at,
      endedAt: null,
      outcome: null,
      summary: null,
      status: 'running',
      ...(index > 2 && role !== 'reviewer' ? { resume: true } : {}),
      ...(round > 1 ? { round } : {}),
    },
  });
  if (summary === null) return;
  if (index % 4 === 3) {
    push(clock.step(minutes / 2), { type: 'run.compacted', runId, sessionId: `session-${role}` });
  }
  push(clock.step(minutes), { type: 'run.ended', runId, outcome: 'completed', summary });
}

function pullRequest(number: number, state: 'open' | 'merged', at: number, base?: string) {
  return {
    number,
    url: `https://github.com/superwall/paywall-next/pull/${number}`,
    state,
    checks: 'passing' as const,
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: at,
    ...(base ? { base } : {}),
  };
}

interface RoundCounter {
  runs: number;
  round: number;
}

function planRound(
  push: Push,
  clock: SeedClock,
  script: RoundScript,
  counter: RoundCounter,
  version: number
) {
  run(
    push,
    clock,
    [counter.runs++, counter.round] as [number, number],
    'planner',
    3,
    `Planned: ${script.title}.`
  );
  push(clock.step(0.2), {
    type: 'spec.proposed',
    taskId: TASK,
    body: script.spec.goal,
    document: script.spec,
  });
  push(clock.step(4), { type: 'spec.approved', taskId: TASK, version });
}

function buildPhases(
  push: Push,
  clock: SeedClock,
  script: RoundScript,
  counter: RoundCounter,
  finished: number
) {
  for (let index = 0; index < finished; index += 1) {
    run(
      push,
      clock,
      [counter.runs++, counter.round] as [number, number],
      'builder',
      9,
      `${script.spec.plan[index]?.title ?? 'Phase'}: done.`
    );
    push(clock.step(0.1), {
      type: 'phase.completed',
      taskId: TASK,
      report: {
        index,
        summary: script.spec.plan[index]?.detail ?? 'Done.',
        spots: [],
        decisions: [],
        at: 0,
      },
    });
    push(clock.step(0), { type: 'phase.updated', taskId: TASK, index, status: 'done' });
  }
}

function finishRound(push: Push, clock: SeedClock, script: RoundScript, counter: RoundCounter) {
  buildPhases(push, clock, script, counter, script.spec.plan.length);
  push(clock.step(0.3), {
    type: 'checks.recorded',
    taskId: TASK,
    results: [{ name: 'bun test', outcome: 'pass', detail: null }],
  });
  push(clock.step(0.1), { type: 'work.submitted', taskId: TASK, summary: `${script.title}.`, report: null });
  run(push, clock, [counter.runs++, counter.round] as [number, number], 'reviewer', 4, 'No findings.');
  push(clock.step(0.1), { type: 'review.reported', taskId: TASK, findings: [] });
}

function newRound(push: Push, clock: SeedClock, number: number, script: RoundScript) {
  push(clock.step(6), {
    type: 'task.messaged',
    taskId: TASK,
    text: script.request,
    kind: 'new_round',
    round: number,
  });
  push(clock.step(0.1), {
    type: 'round.queued',
    taskId: TASK,
    round: {
      number,
      title: script.title,
      request: script.request,
      why: null,
      shipping: script.shipping ?? 'onto_pull_request',
      pipeline: PIPELINE,
    },
  });
}

function startRound(
  push: Push,
  clock: SeedClock,
  number: number,
  choice: { branch: string; base: string | null; onto: number | null }
) {
  push(clock.step(0.1), { type: 'round.started', taskId: TASK, number, ...choice });
  push(clock.step(0.1), {
    type: 'task.staged',
    taskId: TASK,
    stage: 'planning',
    reason: 'planning the round',
  });
}

function scriptRounds(push: Push, clock: SeedClock, worktree: string) {
  const counter: RoundCounter = { runs: 0, round: 1 };
  const [first, second, third, fourth, fifth] = ROUNDS as [
    RoundScript,
    RoundScript,
    RoundScript,
    RoundScript,
    RoundScript,
  ];
  push(clock.step(0.1), { type: 'worktree.created', taskId: TASK, path: worktree, branch: BRANCH });
  planRound(push, clock, first, counter, 1);
  finishRound(push, clock, first, counter);
  push(clock.step(1), {
    type: 'pull_request.opened',
    taskId: TASK,
    pullRequest: pullRequest(4602, 'open', clock.at),
  });
  push(clock.step(0.1), {
    type: 'task.staged',
    taskId: TASK,
    stage: 'awaiting_merge',
    reason: 'waiting for merge',
  });

  newRound(push, clock, 2, second);
  counter.round = 2;
  startRound(push, clock, 2, { branch: BRANCH, base: null, onto: 4602 });
  planRound(push, clock, second, counter, 1);
  finishRound(push, clock, second, counter);
  push(clock.step(0.5), { type: 'pull_request.pushed', taskId: TASK, sha: 'a1b2c3d' });
  push(clock.step(0.1), {
    type: 'task.staged',
    taskId: TASK,
    stage: 'awaiting_merge',
    reason: 'waiting for merge',
  });

  newRound(push, clock, 3, third);
  counter.round = 3;
  startRound(push, clock, 3, { branch: BRANCH, base: null, onto: 4602 });
  planRound(push, clock, third, counter, 1);
  finishRound(push, clock, third, counter);
  push(clock.step(0.5), { type: 'pull_request.pushed', taskId: TASK, sha: 'b2c3d4e' });
  push(clock.step(30), {
    type: 'pull_request.updated',
    taskId: TASK,
    pullRequest: pullRequest(4602, 'merged', clock.at),
  });
  push(clock.step(0.1), { type: 'task.staged', taskId: TASK, stage: 'merged', reason: 'merged' });

  newRound(push, clock, 4, fourth);
  counter.round = 4;
  startRound(push, clock, 4, { branch: `${BRANCH}-4`, base: null, onto: null });
  planRound(push, clock, fourth, counter, 1);
  finishRound(push, clock, fourth, counter);
  push(clock.step(1), {
    type: 'pull_request.opened',
    taskId: TASK,
    pullRequest: pullRequest(4618, 'open', clock.at),
  });
  push(clock.step(0.1), {
    type: 'task.staged',
    taskId: TASK,
    stage: 'awaiting_merge',
    reason: 'waiting for merge',
  });

  newRound(push, clock, 5, fifth);
  counter.round = 5;
  startRound(push, clock, 5, { branch: `${BRANCH}-5`, base: `${BRANCH}-4`, onto: null });
  planRound(push, clock, fifth, counter, 1);
  buildPhases(push, clock, fifth, counter, 1);
  push(clock.step(0.2), { type: 'phase.updated', taskId: TASK, index: 1, status: 'active' });
  push(clock.step(0.1), {
    type: 'task.staged',
    taskId: TASK,
    stage: 'building',
    reason: 'building phase 2 of 2',
  });
  run(push, clock, [counter.runs++, counter.round] as [number, number], 'builder', 0, null);

  push(clock.step(1), {
    type: 'task.messaged',
    taskId: TASK,
    text: 'Then show each tool’s latency in the chat header.',
    kind: 'new_round',
    round: 6,
  });
  push(clock.step(0.1), {
    type: 'round.queued',
    taskId: TASK,
    round: {
      number: 6,
      title: 'Show tool latency in the chat header',
      request: 'Then show each tool’s latency in the chat header.',
      why: null,
      shipping: 'onto_pull_request',
      pipeline: PIPELINE,
    },
  });
  push(clock.step(0.5), {
    type: 'task.messaged',
    taskId: TASK,
    text: 'And while you are in there, rewrite the paywall editor’s undo stack.',
    kind: 'separate_task',
  });
  push(clock.step(0.2), {
    type: 'task.suggested',
    taskId: TASK,
    suggestion: {
      id: 'suggestion-undo-stack',
      runId: `${TASK}-run-${counter.runs - 1}`,
      title: 'Rewrite the paywall editor’s undo stack',
      intent: 'Rewrite the paywall editor’s undo stack.',
      why: 'The editor’s undo stack has nothing to do with the agent’s MCP session.',
      waitsOnThis: false,
      status: 'open',
      createdTaskId: null,
      suggestedAt: clock.at,
      splitOff: true,
    },
  });
}

export function listRoundTasks(repos: { paywall: Repo }, worktree: string): SeedTask[] {
  return [
    {
      id: TASK,
      intent: ROUNDS[0]?.request ?? '',
      title: ROUNDS[0]?.title ?? '',
      repo: repos.paywall,
      size: 'large',
      stage: 'building',
      reason: 'building phase 2 of 2',
      branch: BRANCH,
      ageHours: 30,
      script: (push, clock) => scriptRounds(push, clock, worktree),
    },
  ];
}
