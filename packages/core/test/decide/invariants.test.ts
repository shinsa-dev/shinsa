import { describe, expect, test } from 'bun:test';
import { isTaskLive } from '../../src/decide/liveness.ts';
import {
  applyEvent,
  type ConfigProblem,
  createState,
  DomainError,
  decide,
  type Gate,
  type GateDecision,
  isAgentQuestion,
  isDecisionGate,
  isDependencyOf,
  isOverBudget,
  isTaskSettled,
  listActiveRuns,
  listMissingEvidence,
  listOpenBlockers,
  listOpenGates,
  listPendingDependencies,
  type PlanDocument,
  type PullRequest,
  type ReportCheck,
  type ReviewFinding,
  RUN_STAGES,
  type RunAccount,
  type RunFailureClass,
  type RunUsage,
  replayEventLog,
  resolveCurrentRound,
  resolveQueue,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
  type Task,
} from '../../src/index.ts';
import { IMPACT, PLAN } from '../harness.ts';
import {
  assertDelegationInvariants,
  assertDelegationProgress,
  listCreatedTaskMarks,
  listDelegationCommands,
  listDelegationMarks,
} from './delegation-invariants.ts';
import { assertHandleInvariants, listProjectMarks, selectProjectCommand } from './project-invariants.ts';
import {
  assertRoundInvariants,
  listComposedRoundCommands,
  listLaterChangeAnswers,
  listRoundCommands,
  listRoundMarks,
} from './round-invariants.ts';
import {
  assertScheduleInvariants,
  listScheduleCommands,
  listScheduleMarks,
  listScheduleWriteMarks,
  selectScheduleWrite,
} from './schedule-invariants.ts';
import { assertShapeInvariants, listShapeCommands, listShapeMarks } from './shape-invariants.ts';

type Random = () => number;

function createRandom(seed: number): Random {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function chance(random: Random, odds: number) {
  return random() < odds;
}

function sample<T>(random: Random, items: readonly T[]) {
  return items.filter(() => chance(random, 0.04)).slice(0, 2);
}

const SEEDS = Number(process.env.SHINSA_SEEDS ?? 30);

const RARE_SEEDS = Math.max(SEEDS, 60);

const DELEGATION_ODDS = 0.12;

const SCHEDULE_ODDS = 0.06;

const OUTAGE_ODDS = 0.05;

const SHAPE_ODDS = 0.12;

const ROUND_ODDS = 0.35;
const COMPOSITION_ODDS = 0.25;

const STEPS = 400;

const DECISIONS: GateDecision[] = [
  'approve',
  'approve',
  'approve',
  'approve',
  'revise',
  'reply',
  'waive',
  'reject',
];

function randomChecks(random: Random): ReportCheck[] {
  return [
    { name: 'lint', outcome: chance(random, 0.7) ? 'pass' : 'fail', detail: null },
    {
      name: pick(random, ['types', 'tests']) ?? 'types',
      outcome: chance(random, 0.8) ? 'pass' : 'fail',
      detail: 'x',
    },
  ];
}

function randomFindings(random: Random): ReviewFinding[] {
  if (chance(random, 0.6)) return [];
  return [
    {
      severity: chance(random, 0.6) ? 'blocking' : 'suggestion',
      file: pick(random, ['a.ts', 'b.ts', null]) ?? null,
      line: 1,
      message: 'Look here.',
    },
  ];
}

function randomPullRequest(random: Random): PullRequest {
  return {
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    state: chance(random, 0.85) ? 'open' : chance(random, 0.7) ? 'merged' : 'closed',
    checks: pick(random, ['passing', 'passing', 'passing', 'failing', 'pending', 'none']) ?? 'passing',
    unresolvedComments: chance(random, 0.9) ? 0 : 1,
    mergeable: pick(random, [true, true, true, false, null]) ?? true,
    headSha: chance(random, 0.9) ? null : 'stale',
    updatedAt: 0,
  };
}

function resolvePlanDocument(state: ShinsaState): PlanDocument {
  if (state.seq % 11 === 0) return { ...PLAN, verification: [] };
  if (state.seq % 13 === 0) return { ...PLAN, evidence: ['screenshot'], approval: true };
  if (state.seq % 4 === 0) return PLAN;
  return { ...PLAN, impact: IMPACT, operation: ['Run the backfill and check every row has a plan.'] };
}

function needsEvidence(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  const attached = Object.values(state.evidence).filter((evidence) => evidence.taskId === taskId);
  return listMissingEvidence(task?.plan?.document ?? null, attached).length > 0;
}

function listAgentCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const commands: ShinsaCommand[] = [];
  for (const run of Object.values(state.runs)) {
    const runId = run.id;
    if (run.endedAt !== null) {
      if (chance(random, 0.05)) commands.push({ type: 'agent.note', runId, note: 'Late.' });
      continue;
    }
    switch (run.role) {
      case 'planner':
        commands.push({ type: 'agent.propose_plan', runId, document: resolvePlanDocument(state) });
        break;
      case 'builder':
        commands.push({
          type: 'agent.complete_phase',
          runId,
          summary: 'Done.',
          spots: [],
          judgementCalls: [],
        });
        if (needsEvidence(state, run.taskId) && chance(random, 0.5)) {
          commands.push({
            type: 'agent.attach_evidence',
            runId,
            kind: 'screenshot',
            title: 'The panel',
            uri: 'shot.png',
          });
        }
        break;
      case 'reviewer':
        commands.push({ type: 'agent.report_review', runId, findings: randomFindings(random) });
        break;
      case 'operator':
        commands.push({ type: 'agent.deliver', runId, step: 'operate', body: 'Ran it.' });
        break;
      default:
        commands.push({ type: 'agent.complete_fix', runId, summary: 'Fixed.' });
    }
    if (chance(random, 0.3)) {
      commands.push({
        type: 'agent.ask',
        runId,
        gateId: `q-${state.seq}`,
        question: 'Which one?',
        context: null,
      });
    }
    commands.push(
      { type: 'agent.note', runId, note: 'Working.' },
      {
        type: 'run.end',
        runId,
        outcome: pick(random, ['completed', 'failed', 'cancelled']) ?? 'failed',
        summary: null,
      },
      { type: 'run.link', runId, sessionId: `s-${runId}`, provider: 'claude' }
    );
    if (chance(random, 0.2)) commands.push(...listAttemptCommands(runId, state.seq, random));
  }
  return commands;
}

const FAILURE_CLASSES: RunFailureClass[] = [
  'usage_limit',
  'auth',
  'context_window_full',
  'overloaded',
  'provider_error',
  'transport_error',
  'aborted',
  'image_error',
  'setup_failed',
  'session_lost',
];

const LOGIN_PROVIDERS = ['codex', 'cursor'];

const ACCOUNTS: RunAccount[] = [
  { id: 'acc-1', email: 'one@example.com' },
  { id: 'acc-2', email: null },
];

function listAccountEndings(runId: string, seq: number, random: Random): ShinsaCommand[] {
  const account = pick(random, ACCOUNTS) ?? null;
  const resetAt = 1_000 + seq * 15_000 + (pick(random, [-60_000, 0, 30 * 60_000, 5 * 60 * 60_000]) ?? 0);
  return [
    {
      type: 'run.end',
      runId,
      outcome: 'failed',
      summary: 'Limit.',
      failure: { class: 'usage_limit', message: 'Limit.', code: null, retryable: true, resetAt, account },
    },
    {
      type: 'run.end',
      runId,
      outcome: 'failed',
      summary: 'Signed out.',
      failure: { class: 'auth', message: 'Signed out.', code: null, retryable: null, resetAt: null, account },
    },
    {
      type: 'run.end',
      runId,
      outcome: 'failed',
      summary: 'Signed out of Codex.',
      failure: {
        class: 'auth',
        message: 'Signed out.',
        code: null,
        retryable: null,
        resetAt: null,
        login: { provider: pick(random, LOGIN_PROVIDERS) ?? 'codex', email: null },
      },
    },
  ];
}

function listAttemptCommands(runId: string, seq: number, random: Random): ShinsaCommand[] {
  const failureClass = pick(random, FAILURE_CLASSES) ?? 'aborted';
  return [
    ...listAccountEndings(runId, seq, random),
    {
      type: 'run.attempt',
      runId,
      attemptId: `acc-${seq}`,
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      account: pick(random, ACCOUNTS) ?? null,
    },
    {
      type: 'run.attempt',
      runId,
      attemptId: `a-${seq}`,
      provider: 'claude',
      model: null,
      resumed: chance(random, 0.5),
      handoff: null,
    },
    { type: 'run.interrupt', runId },
    { type: 'run.continue', runId },
    { type: 'run.record_lost_session', runId, sessionId: `s-${runId}` },
    { type: 'agent.note', runId, note: 'Stale.', attemptId: 'stale' },
    { type: 'run.end', runId, outcome: 'failed', summary: null, attemptId: 'stale' },
    {
      type: 'run.end',
      runId,
      outcome: 'failed',
      summary: failureClass,
      failure: {
        class: failureClass,
        message: `${failureClass}.`,
        code: null,
        retryable: null,
        resetAt: null,
      },
    },
  ];
}

function listPullRequestReads(state: ShinsaState, task: Task, random: Random): ShinsaCommand[] {
  if (task.stage === 'shipping' || task.stage === 'awaiting_merge') {
    const merging = task.stage === 'awaiting_merge' && listOpenGates(state, task.id).length === 0;
    const pullRequest = randomPullRequest(random);
    const merged = merging && chance(random, 0.7);
    return [
      {
        type: 'pull_request.record',
        taskId: task.id,
        pullRequest: merged ? { ...pullRequest, state: 'merged' } : pullRequest,
      },
    ];
  }
  if (!chance(random, 0.02) || (!task.pullRequest && task.phaseReports.length === 0)) return [];
  return [{ type: 'pull_request.record', taskId: task.id, pullRequest: randomPullRequest(random) }];
}

function listSystemCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const commands: ShinsaCommand[] = [];
  const taskIds = Object.keys(state.tasks);
  for (const task of Object.values(state.tasks)) {
    const taskId = task.id;
    if (task.stage === 'triage' && task.branch === null) {
      commands.push({
        type: 'task.triage',
        taskId,
        title: `Task ${taskId}`,
        repoId: chance(random, 0.15) ? null : 'repo',
        size: chance(random, 0.5) ? 'large' : 'small',
        branch: `b-${taskId}`,
        waitsOn: sample(random, taskIds),
      });
    }
    if (task.stage === 'triage' && task.branch !== null) {
      commands.push({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: task.branch });
    }
    if (task.stage === 'checking')
      commands.push({ type: 'checks.record', taskId, results: randomChecks(random) });
    if (task.pushPending)
      commands.push({ type: 'pull_request.record_push', taskId, sha: `sha-${state.seq}` });
    commands.push(...listPullRequestReads(state, task, random));
    if (chance(random, 0.03))
      commands.push({ type: 'effect.fail', taskId, title: 'Effect failed', detail: 'x' });
    if (task.worktreePath && isTaskSettled(task)) commands.push({ type: 'worktree.gone', taskId });
    if (chance(random, 0.03)) commands.push({ type: 'message.deliver', taskId, text: 'Missed steer.' });
  }
  commands.push({ type: 'runs.dispatch' });
  return commands;
}

function listUserCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const taskIds = Object.keys(state.tasks);
  const commands: ShinsaCommand[] = [
    {
      type: 'task.create',
      request: 'Do something',
      repoId: 'repo',
      priority: pick(random, ['urgent', 'high', 'normal', 'low']),
      waitsOn: sample(random, taskIds),
      planFirst: taskIds.length % 4 === 3,
    },
  ];
  const open = Object.values(state.tasks).filter((task) => !isTaskSettled(task));
  for (const gate of listOpenGates(state)) {
    const other = pick(
      random,
      open.filter((task) => task.id !== gate.taskId)
    );
    if (other && gate.type === 'merge') {
      commands.push({ type: 'task.wait_on', taskId: gate.taskId, waitsOn: [other.id] });
    }
    commands.push({
      type: 'gate.answer',
      gateId: gate.id,
      decision: pick(random, DECISIONS) ?? 'approve',
      response: chance(random, 0.7) ? 'Sounds right.' : null,
    });
  }
  const taskId = pick(random, taskIds);
  if (taskId) {
    commands.push(
      { type: 'task.message', taskId, text: 'Also this.' },
      { type: 'task.retry', taskId },
      { type: 'task.prioritize', taskId, priority: pick(random, ['high', 'low']) ?? 'low' }
    );
    if (chance(random, 0.3))
      commands.push({ type: 'task.wait_on', taskId, waitsOn: sample(random, taskIds) });
    if (chance(random, 0.08)) commands.push({ type: 'task.cancel', taskId });
    if (chance(random, 0.04)) commands.push({ type: 'task.complete', taskId });
  }
  if (chance(random, 0.05)) {
    commands.push({
      type: 'settings.change',
      patch: { approvePlans: chance(random, 0.5), maxFixRounds: pick(random, [null, 1, 3]) ?? null },
    });
  }
  return commands;
}

const VERIFIED_PROBLEMS: ConfigProblem[][] = [
  [],
  [],
  [],
  [{ kind: 'check_commands', detail: 'No checks.' }],
  [{ kind: 'default_branch', detail: 'No main.' }],
];

function randomUsage(random: Random): RunUsage {
  const tokens = Math.floor(random() * 5_000);
  return {
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: chance(random, 0.8) ? random() * 3 : null,
  };
}

function listProcessAgentCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  return Object.values(state.runs).flatMap((run): ShinsaCommand[] => {
    if (run.endedAt !== null) return [];
    const runId = run.id;
    const commands: ShinsaCommand[] = [
      {
        type: 'agent.wait_for',
        runId,
        checkInMinutes: 1 + Math.floor(random() * 3),
        notes: 'Wait for the deploy.',
        timeoutMinutes: chance(random, 0.5) ? 2 + Math.floor(random() * 10) : null,
        maxAttempts: chance(random, 0.5) ? 1 + Math.floor(random() * 3) : null,
      },
      {
        type: 'agent.suggest_tasks',
        runId,
        suggestions: [
          {
            title: `Follow up ${state.seq % 7}`,
            request: 'Do more.',
            why: 'Seen.',
            waitsOnThis: chance(random, 0.5),
          },
        ],
      },
      {
        type: 'agent.ask',
        runId,
        gateId: `c-${state.seq}`,
        question: 'Which one?',
        context: null,
        choices: ['A', 'B'],
        recommendation: 'A',
      },
      { type: 'run.meter', runId, usage: randomUsage(random), weeklyPercent: (state.seq % 4) * 2 },
      { type: 'run.silence', runId, since: chance(random, 0.7) ? state.seq : null },
    ];
    if (run.role === 'answerer')
      commands.push({ type: 'agent.deliver', runId, step: 'answer', body: 'It works like this.' });
    if (run.role === 'fixer') {
      const fix: ShinsaCommand = {
        type: 'agent.complete_fix',
        runId,
        summary: 'Fixed.',
        treeHash: `t-${state.seq % 3}`,
      };
      commands.push(fix, fix, fix);
    }
    if (run.role === 'reviewer') {
      const review: ShinsaCommand = {
        type: 'agent.report_review',
        runId,
        findings: [{ severity: 'blocking', file: 'a.ts', line: 1, message: `Again ${state.seq % 2}` }],
      };
      commands.push(review, review, review);
    }
    if (run.role === 'planner') {
      commands.push({ type: 'agent.propose_plan', runId, document: PLAN, changeSummary: 'Tightened it.' });
    }
    return commands;
  });
}

function listProcessSystemCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  return Object.values(state.tasks).flatMap((task): ShinsaCommand[] => {
    const commands: ShinsaCommand[] = [];
    if (task.stage === 'triage' && task.size !== null) {
      commands.push({
        type: 'config.record',
        taskId: task.id,
        problems: pick(random, VERIFIED_PROBLEMS) ?? [],
        ...(task.repoId === null && chance(random, 0.5) ? { repoId: 'repo' } : {}),
      });
    }
    const monitor = task.monitor;
    if (monitor) {
      commands.push(
        { type: 'monitor.fire', taskId: task.id, monitorId: monitor.id, attempt: monitor.attempts + 1 },
        { type: 'monitor.fire', taskId: task.id, monitorId: monitor.id, attempt: monitor.attempts }
      );
    }
    if (task.usageWait) {
      commands.push(
        { type: 'usage_wait.resume', taskId: task.id, waitId: task.usageWait.id },
        { type: 'usage_wait.resume', taskId: task.id, waitId: 'stale' }
      );
    }
    for (const account of ACCOUNTS) {
      if (chance(random, 0.3)) commands.push({ type: 'account.signed_in', account });
      if (chance(random, 0.05)) commands.push({ type: 'account.removed', accountId: account.id });
    }
    for (const provider of LOGIN_PROVIDERS) {
      if (chance(random, 0.3)) commands.push({ type: 'provider.record_sign_in', provider });
    }
    return commands;
  });
}

function budgetLimits(limit: number | null): ShinsaCommand {
  return {
    type: 'settings.change',
    patch: { taskBudgetUsd: limit, taskUsageLimit: limit === null ? null : limit * 2 },
  };
}

function listProcessUserCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const commands: ShinsaCommand[] = [
    { type: 'task.create', request: 'How does it work?', repoId: 'repo', mode: 'ask' },
    budgetLimits(pick(random, [null, 2, 5]) ?? null),
    { type: 'settings.change', patch: { approvePlans: true } },
  ];
  for (const gate of listOpenGates(state)) {
    const task = state.tasks[gate.taskId];
    commands.push({
      type: 'gate.answer',
      gateId: gate.id,
      decision: pick(random, DECISIONS) ?? 'approve',
      response: 'Sure.',
      planVersion: chance(random, 0.8) ? (task?.plan?.version ?? 1) : 99,
      verdicts: (task?.findings ?? []).map((_, index) => ({
        index,
        verdict: chance(random, 0.5) ? 'fix' : 'dismiss',
        note: null,
      })),
    });
  }
  for (const task of Object.values(state.tasks)) {
    for (const suggestion of task.suggestions ?? []) {
      commands.push(
        {
          type: 'suggestion.accept',
          taskId: task.id,
          suggestionId: suggestion.id,
          waitsOnThis: chance(random, 0.5),
        },
        { type: 'suggestion.dismiss', taskId: task.id, suggestionId: suggestion.id }
      );
    }
    if (task.monitor) commands.push({ type: 'monitor.check_in_now', taskId: task.id });
    commands.push({
      type: 'task.bind_account',
      taskId: task.id,
      account: pick(random, [null, ...ACCOUNTS]) ?? null,
    });
    if (task.usageWait) {
      commands.push(
        { type: 'usage_wait.change', taskId: task.id, autoResume: chance(random, 0.5) },
        { type: 'usage_wait.resume_now', taskId: task.id }
      );
    }
  }
  for (const run of Object.values(state.runs)) {
    commands.push(
      { type: 'run.snooze_silence', runId: run.id, until: state.seq * 15_000 + 600_000 },
      { type: 'run.dismiss_silence', runId: run.id }
    );
  }
  return commands;
}

const RERUN_ACCOUNTS = [
  { id: 'acc-work', email: 'work@example.com' },
  { id: 'acc-home', email: null },
];

function selectRerun(state: ShinsaState, side: Random): ShinsaCommand | null {
  if (!chance(side, OUTAGE_ODDS)) return null;
  const working = Object.values(state.tasks).filter(
    (task) => RUN_STAGES.has(task.stage) || chance(side, 0.05)
  );
  const chosen = pick(side, working);
  const account = pick(side, RERUN_ACCOUNTS);
  return chosen && account ? { type: 'task.retry', taskId: chosen.id, account } : null;
}

function selectOutage(state: ShinsaState, outage: Random): ShinsaCommand | null {
  const readable = Object.values(state.tasks).filter((task) => task.pullRequest && !isTaskSettled(task));
  const failing = readable.filter((task) => (task.pullRequestReadFailures ?? 0) > 0);
  const odds = failing.length > 0 ? 0.6 : OUTAGE_ODDS;
  if (!chance(outage, odds)) return null;
  const chosen = pick(outage, failing.length > 0 ? failing : readable);
  return chosen ? { type: 'pull_request.read_failed', taskId: chosen.id, detail: 'HTTP 502.' } : null;
}

function selectShapeCommand(state: ShinsaState, shaping: Random, combined: boolean): ShinsaCommand | null {
  if (!chance(shaping, combined ? COMPOSITION_ODDS : SHAPE_ODDS)) return null;
  return pick(shaping, listShapeCommands(state, shaping, combined)) ?? { type: 'runs.dispatch' };
}

function nextCommand(
  state: ShinsaState,
  random: Random,
  side: Random = random,
  extra: Random | null = null,
  shaping: Random | null = null,
  combined = false
): ShinsaCommand {
  const shape = shaping ? selectShapeCommand(state, shaping, combined) : null;
  if (shape) return shape;
  if (extra && chance(extra, SCHEDULE_ODDS)) {
    return pick(extra, listScheduleCommands(state, extra)) ?? { type: 'runs.dispatch' };
  }
  if (side !== random && chance(side, DELEGATION_ODDS)) {
    return pick(side, listDelegationCommands(state, side)) ?? { type: 'runs.dispatch' };
  }
  const roll = random();
  const pool =
    roll < 0.36
      ? listAgentCommands(state, random)
      : roll < 0.66
        ? listSystemCommands(state, random)
        : roll < 0.78
          ? listUserCommands(state, random)
          : roll < 0.9
            ? listProcessAgentCommands(state, random)
            : roll < 0.96
              ? listProcessSystemCommands(state, random)
              : listProcessUserCommands(state, random);
  return pick(random, pool) ?? { type: 'runs.dispatch' };
}

function assertProcessInvariants(state: ShinsaState, task: Task, gates: Gate[], context: string) {
  const runs = listActiveRuns(state, task.id);
  for (const gate of gates.filter((open) => open.type === 'plan')) {
    expect(gate.planVersion ?? task.plan?.version, context).toBe(task.plan?.version);
  }
  if (task.monitor?.status === 'armed') {
    expect(runs, context).toHaveLength(0);
    expect(isTaskSettled(task), context).toBe(false);
  }
  expect(
    task.monitor?.status === 'armed' && task.usageWait?.status === 'armed',
    `${context}: a monitor and a usage wait are both armed`
  ).toBe(false);
  if (task.usageWait?.status === 'armed') {
    expect(runs, context).toHaveLength(0);
    expect(isTaskSettled(task), context).toBe(false);
    expect(
      gates.some((gate) => gate.type === 'failure' || gate.type === 'sign_in'),
      context
    ).toBe(false);
  }
  const signIn = gates.filter((gate) => gate.type === 'sign_in');
  expect(signIn.length, context).toBeLessThanOrEqual(1);
  for (const gate of signIn) {
    expect(gate.provider, `${context}: a Sign in gate without its provider`).toBeTruthy();
    if (gate.provider === 'claude')
      expect(gate.account, `${context}: a Claude Sign in gate without its account`).toBeTruthy();
    else expect(gate.account ?? null, `${context}: a provider login names an account`).toBeNull();
  }
  const configuration = gates.filter((gate) => gate.type === 'configuration');
  expect(configuration.length, context).toBeLessThanOrEqual(1);
  if (configuration.length > 0) expect(task.stage, context).toBe('triage');
  for (const gate of gates.filter((open) => open.cause === 'budget')) {
    expect(isOverBudget(state, task), `${context}: budget gate ${gate.id} while within budget`).toBe(true);
  }
  expect(
    (task.suggestions ?? []).filter((suggestion) => suggestion.status === 'open').length
  ).toBeLessThanOrEqual(10);
}

function assertInvariants(state: ShinsaState, now: number) {
  const queue = resolveQueue(state, now);
  const seen = new Map<string, string>();
  const place = (taskId: string, where: string) => {
    const previous = seen.get(taskId);
    if (previous && previous !== where) throw new Error(`${taskId} is both ${previous} and ${where}`);
    seen.set(taskId, where);
  };
  for (const entry of queue.ready) place(entry.task.id, 'deciding');
  for (const task of queue.working) place(task.id, 'working');
  for (const task of queue.waiting) place(task.id, 'waiting');

  assertScheduleInvariants(state);
  assertHandleInvariants(state);
  for (const task of Object.values(state.tasks)) {
    const runs = listActiveRuns(state, task.id);
    const gates = listOpenGates(state, task.id);
    const kinds = (kind: string) => gates.filter((gate) => gate.type === kind && isDecisionGate(gate));
    const context = `${task.id} at ${task.stage} (${task.stageReason})`;

    expect(runs.length, context).toBeLessThanOrEqual(1);
    expect(
      runs.every((run) => run.status === 'running' || run.status === 'waiting'),
      context
    ).toBe(true);
    assertDelegationInvariants(state, task, context);
    expect(isTaskLive(state, task), context).toBe(true);
    expect(task.waitsOn.includes(task.id), context).toBe(false);
    expect(
      task.waitsOn.some((id) => isDependencyOf(state, task.id, id)),
      context
    ).toBe(false);

    assertShapeInvariants(task, gates, state, context);
    assertRoundInvariants(state, task, context);
    if (isTaskSettled(task)) {
      expect(runs, context).toHaveLength(0);
      expect(gates, context).toHaveLength(0);
      continue;
    }
    if (runs.length > 0) {
      expect(RUN_STAGES.has(task.stage), context).toBe(true);
      expect(
        gates.every((gate) => isAgentQuestion(gate) && gate.runId === runs[0]?.id),
        context
      ).toBe(true);
    }
    for (const gate of gates.filter(isAgentQuestion)) {
      expect(
        runs.some((run) => run.id === gate.runId),
        context
      ).toBe(true);
    }
    expect(gates.filter((gate) => gate.type === 'failure').length, context).toBeLessThanOrEqual(1);
    for (const kind of ['plan', 'review', 'merge']) {
      expect(kinds(kind).length, context).toBeLessThanOrEqual(1);
    }
    expect(kinds('plan').length === 1, context).toBe(task.stage === 'awaiting_plan');
    expect(kinds('review').length === 1, context).toBe(task.stage === 'awaiting_review');
    if (kinds('merge').length === 1) {
      expect(task.stage, context).toBe('awaiting_merge');
      expect(listOpenBlockers(state, task), context).toHaveLength(0);
    }
    if (task.stage === 'waiting_on_tasks') {
      expect(listPendingDependencies(state, task).length > 0 || gates.length > 0, context).toBe(true);
    }
    assertProcessInvariants(state, task, gates, context);
  }
  for (const gate of Object.values(state.gates)) {
    if (gate.supersededBy !== undefined) expect(gate.status).toBe('withdrawn');
  }
}

type SideStream =
  | 'outages'
  | 'reruns'
  | 'shapes'
  | 'compositions'
  | 'writes'
  | 'projects'
  | 'rounds'
  | 'composed_rounds'
  | 'on_behalf'
  | null;

function selectOnBehalfCommand(state: ShinsaState, random: Random): ShinsaCommand | null {
  if (!chance(random, ROUND_ODDS)) return null;
  const commands = chance(random, 0.5)
    ? listUserCommands(state, random)
    : listProcessUserCommands(state, random);
  return pick(random, commands) ?? null;
}

const FINISHED_STAGES = new Set(['merged', 'done']);

const CLOSING_EVENTS = new Set(['gate.answered', 'gate.withdrawn', 'gate.superseded']);

function assertHumanGatesKept(
  prior: ShinsaState,
  events: ReturnType<typeof decide>['events'],
  command: ShinsaCommand
) {
  const open = new Set(listOpenGates(prior).map((gate) => gate.id));
  for (const event of events) {
    if (!CLOSING_EVENTS.has(event.type) || !('gateId' in event)) continue;
    expect(open.has(event.gateId), `${command.type} on your behalf closed an open gate (${event.type})`).toBe(
      false
    );
  }
  for (const gate of listOpenGates(prior)) {
    const before = prior.tasks[gate.taskId]?.stage ?? 'triage';
    const staged = events.flatMap((event) =>
      event.type === 'task.staged' && event.taskId === gate.taskId ? [event.stage] : []
    );
    const after = staged.at(-1) ?? before;
    const finished = FINISHED_STAGES.has(after) && after !== before;
    expect(finished, `${command.type} on your behalf finished a task waiting on the human`).toBe(false);
  }
}

function selectRoundCommand(state: ShinsaState, rounds: Random, composing: boolean): ShinsaCommand | null {
  const answers = composing ? listLaterChangeAnswers(state, rounds) : [];
  if (answers.length > 0) return pick(rounds, answers) ?? null;
  if (!chance(rounds, ROUND_ODDS)) return null;
  const commands = composing ? listComposedRoundCommands(state, rounds) : listRoundCommands(state, rounds);
  return pick(rounds, commands) ?? null;
}

interface SideRandoms {
  outage: Random;
  rerun: Random;
  writer: Random;
  planner: Random;
  rounds: Random;
}

function selectSideCommand(
  sideStream: SideStream,
  state: ShinsaState,
  randoms: SideRandoms,
  now: number
): ShinsaCommand | null {
  switch (sideStream) {
    case 'outages':
      return selectOutage(state, randoms.outage);
    case 'reruns':
      return selectRerun(state, randoms.rerun);
    case 'writes':
      return selectScheduleWrite(state, randoms.writer);
    case 'projects':
      return selectProjectCommand(state, randoms.planner, now);
    case 'rounds':
      return selectRoundCommand(state, randoms.rounds, false);
    case 'composed_rounds':
      return selectRoundCommand(state, randoms.rounds, true);
    case 'on_behalf':
      return selectOnBehalfCommand(state, randoms.rounds);
    default:
      return null;
  }
}

function simulate(
  seed: number,
  steps: number,
  sideStream: SideStream = null,
  observe: (state: ShinsaState) => void = () => undefined
) {
  const random = createRandom(seed);
  const side = createRandom(seed * 7_919);
  const extra = createRandom(seed * 104_729);
  const shaping = createRandom(seed * 49_979_687);
  const randoms: SideRandoms = {
    outage: createRandom(seed * 15_485_863),
    rerun: createRandom(seed * 32_452_843),
    writer: createRandom(seed * 67_867_967),
    planner: createRandom(seed * 86_028_121),
    rounds: createRandom(seed * 104_395_301),
  };
  let state = createState();
  state = applyEvent(state, {
    type: 'repo.registered',
    repo: {
      id: 'repo',
      name: 'shinsa',
      path: '/code/shinsa',
      defaultBranch: 'main',
      remote: null,
      projectId: null,
      checkCommands: [],
    },
    seq: 1,
    at: 0,
  });
  const log: ShinsaEvent[] = [{ type: 'repo.registered', repo: state.repos.repo!, seq: 1, at: 0 }];
  let counter = 0;
  let outageCounter = 0;
  const apply = (
    step: number,
    now: number,
    command: ShinsaCommand,
    newId: () => string,
    onBehalf = false
  ) => {
    const before = JSON.stringify(state);
    let decision: ReturnType<typeof decide>;
    try {
      decision = decide(state, command, { now, newId, onBehalf });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      expect(JSON.stringify(state)).toBe(before);
      return;
    }
    expect(JSON.stringify(state), `decide mutated its input on ${command.type}`).toBe(before);
    const prior = state;
    if (onBehalf) assertHumanGatesKept(prior, decision.events, command);
    for (const event of decision.events) {
      const stamped = { ...event, seq: state.seq + 1, at: now } as ShinsaEvent;
      log.push(stamped);
      state = applyEvent(state, stamped);
    }
    try {
      assertInvariants(state, now);
      assertDelegationProgress(prior, state, command.type);
    } catch (error) {
      throw new Error(`seed ${seed}, step ${step}, after ${JSON.stringify(command)}: ${String(error)}`);
    }
  };
  for (let step = 0; step < steps; step += 1) {
    const now = 1_000 + step * 15_000;
    const combined = sideStream === 'compositions';
    const shapes = sideStream === 'shapes' || combined ? shaping : null;
    const command = combined
      ? nextCommand(state, random, random, null, shapes, true)
      : nextCommand(state, random, side, extra, shapes);
    apply(step, now, command, () => `${seed}-${++counter}`);
    const sideCommand = selectSideCommand(sideStream, state, randoms, now);
    if (sideCommand) {
      const onBehalf = sideStream === 'on_behalf' || sideCommand.type === 'schedule.write';
      apply(step, now, sideCommand, () => `${seed}-${sideStream}-${++outageCounter}`, onBehalf);
    }
    observe(state);
  }
  expect(replayEventLog(log).state).toEqual(state);
  return state;
}

function listComposedRoundMarks(state: ShinsaState) {
  return Object.values(state.tasks).flatMap((task) => {
    if (resolveCurrentRound(task).number === 1) return [];
    const changes = task.shapeChanges ?? [];
    return [
      changes.some((change) => change.by === 'agent') ? 'composed later round' : null,
      changes.some((change) => change.by === 'you') ? 'later round vetoed' : null,
      changes.some((change) => change.by === 'agent') && task.pullRequest?.state === 'open'
        ? 'composed onto an open pull request'
        : null,
    ];
  });
}

function listReachedStates(state: ShinsaState) {
  const gates = Object.values(state.gates).flatMap((gate) => [
    gate.type === 'configuration' ? 'configuration gate' : null,
    gate.type === 'sign_in' ? 'sign-in gate' : null,
    gate.cause ? `${gate.cause} gate` : null,
    gate.escalation ? 'escalated review' : null,
    gate.supersededBy ? 'historical question' : null,
    (gate.planVersion ?? 0) > 1 ? 'revised plan gate' : null,
  ]);
  const tasks = Object.values(state.tasks).flatMap((task) => [
    task.result?.step === 'answer' ? 'answered question' : null,
    task.monitor ? 'monitor' : null,
    task.usageWait ? 'usage wait' : null,
    task.pullRequestWatch?.stopped === 'unreadable' ? 'unreadable pull request' : null,
    task.suggestions?.some((suggestion) => suggestion.status === 'accepted')
      ? 'accepted suggested task'
      : null,
  ]);
  return [...gates, ...tasks].filter((mark) => mark !== null);
}

describe('decide under random command sequences', () => {
  test(
    'keeps every invariant, and replaying the log rebuilds the same state',
    () => {
      let settled = 0;
      const reached = new Set<string>();
      for (let seed = 1; seed <= RARE_SEEDS; seed += 1) {
        const state = simulate(seed, STEPS);
        settled += Object.values(state.tasks).filter((task) => task.stage === 'merged').length;
        for (const mark of listReachedStates(state)) reached.add(mark);
        for (const mark of [
          ...listDelegationMarks(state),
          ...listCreatedTaskMarks(state),
          ...listScheduleMarks(state),
        ]) {
          if (mark) reached.add(mark);
        }
      }
      expect(settled).toBeGreaterThan(0);
      expect([...reached].sort()).toEqual([
        'accepted suggested task',
        'answered delegation',
        'answered question',
        'answered secret',
        'budget gate',
        'configuration gate',
        'courier task',
        'delivered result',
        'escalated review',
        'historical question',
        'later delivery generation',
        'monitor',
        'monitor gate',
        'nested delegation',
        'revised plan gate',
        'scheduled task',
        'sign-in gate',
        'skipped run',
        'split plan',
        'usage wait',
        'waiting parent',
      ]);
    },
    RARE_SEEDS * 2_000
  );

  test(
    'keeps every invariant while GitHub fails to read pull requests, and stops a watch that cannot read',
    () => {
      const reached = new Set<string>();
      for (let seed = 1; seed <= RARE_SEEDS; seed += 1) {
        for (const mark of listReachedStates(simulate(seed, STEPS, 'outages'))) reached.add(mark);
      }
      expect(reached).toContain('unreadable pull request');
    },
    RARE_SEEDS * 2_000
  );

  test(
    'keeps every invariant while tasks take every shape, propose changes and change shape',
    () => {
      const reached = new Set<string>();
      const collect = (state: ShinsaState) => {
        for (const mark of listShapeMarks(state)) if (mark) reached.add(mark);
      };
      for (let seed = 1; seed <= SEEDS; seed += 1) simulate(seed, STEPS, 'shapes', collect);
      expect([...reached].sort()).toEqual([
        'accepted proposal',
        'answered question',
        'built fix',
        'composed steps',
        'composition vetoed',
        'declined proposal',
        'finished operation',
        'reported diagnosis',
        'reshaped by an agent',
        'reshaped by you',
        'written report',
        'your OK given',
      ]);
    },
    SEEDS * 2_000
  );

  test(
    'keeps every invariant while the planner composes changes with operations before or after them',
    () => {
      const reached = new Set<string>();
      const collect = (state: ShinsaState) => {
        for (const mark of listShapeMarks(state)) if (mark) reached.add(mark);
      };
      for (let seed = 1; seed <= SEEDS; seed += 1) simulate(seed, STEPS, 'compositions', collect);
      expect([...reached]).toEqual(
        expect.arrayContaining([
          'operation after merge',
          'operation before build',
          'operation skipped after merge',
        ])
      );
    },
    SEEDS * 2_000
  );

  test(
    'keeps every invariant while you and reviewers write schedules, and replays what was done for you',
    () => {
      const reached = new Set<string>();
      let actions = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const state = simulate(seed, STEPS, 'writes');
        actions += state.onBehalfActions?.length ?? 0;
        for (const mark of listScheduleWriteMarks(state)) if (mark) reached.add(mark);
      }
      expect(actions).toBeGreaterThan(0);
      expect([...reached].sort()).toEqual([
        'reviewer schedule',
        'schedule you changed',
        'schedule you wrote',
      ]);
    },
    SEEDS * 2_000
  );

  test(
    'keeps every invariant and unique task handles while projects come, go, change keys and take focus',
    () => {
      const reached = new Set<string>();
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        for (const mark of listProjectMarks(simulate(seed, STEPS, 'projects'))) if (mark) reached.add(mark);
      }
      expect([...reached].sort()).toEqual([
        'handle under an earlier key',
        'project in focus',
        'task in a project',
        'task of a removed project',
        'task without a project',
      ]);
    },
    SEEDS * 2_000
  );

  test(
    'never lets a command sent on your behalf close a gate or finish a task that waits at one',
    () => {
      let actions = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        actions += simulate(seed, STEPS, 'on_behalf').onBehalfActions?.length ?? 0;
      }
      expect(actions).toBeGreaterThan(0);
    },
    SEEDS * 2_000
  );

  test(
    'keeps every invariant while steps are rerun on chosen accounts',
    () => {
      let bound = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const state = simulate(seed, STEPS, 'reruns');
        bound += Object.values(state.runs).filter((run) => run.account).length;
      }
      expect(bound).toBeGreaterThan(0);
    },
    SEEDS * 2_000
  );

  test(
    'keeps every invariant while tasks take new rounds, ship them onto one pull request or stacked, and close',
    () => {
      const reached = new Set<string>();
      const collect = (state: ShinsaState) => {
        for (const mark of listRoundMarks(state)) if (mark) reached.add(mark);
      };
      for (let seed = 1; seed <= RARE_SEEDS; seed += 1) simulate(seed, STEPS, 'rounds', collect);
      expect([...reached].sort()).toEqual([
        'closed task',
        'kept split-off',
        'merged later round',
        'round from the default branch',
        'rounds onto one pull request',
        'shipped round',
        'stacked round',
        'three rounds',
        'waiting round',
      ]);
    },
    RARE_SEEDS * 3_000
  );

  test(
    'keeps every invariant while later rounds compose their own steps onto an open pull request',
    () => {
      const reached = new Set<string>();
      const collect = (state: ShinsaState) => {
        for (const mark of listComposedRoundMarks(state)) if (mark) reached.add(mark);
      };
      for (let seed = 1; seed <= RARE_SEEDS; seed += 1) simulate(seed, STEPS, 'composed_rounds', collect);
      expect([...reached].sort()).toEqual([
        'composed later round',
        'composed onto an open pull request',
        'later round vetoed',
      ]);
    },
    RARE_SEEDS * 3_000
  );

  test('is deterministic for the same state, command, clock and ids', () => {
    const random = createRandom(7);
    let state = simulate(7, 120);
    for (let step = 0; step < 50; step += 1) {
      const command = nextCommand(state, random);
      const attempt = () => {
        let counter = 0;
        try {
          return JSON.stringify(decide(state, command, { now: 5_000, newId: () => `d-${++counter}` }));
        } catch (error) {
          return String(error);
        }
      };
      expect(attempt()).toBe(attempt());
      let counter = 0;
      const result = (() => {
        try {
          return decide(state, command, { now: 5_000, newId: () => `d-${step}-${++counter}` });
        } catch {
          return null;
        }
      })();
      if (!result) continue;
      for (const event of result.events)
        state = applyEvent(state, { ...event, seq: state.seq + 1, at: 5_000 } as ShinsaEvent);
    }
  });
});
