import {
  type Gate,
  type PipelineStep,
  type PlanDocument,
  type PullRequest,
  type RunRole,
  type TaskStage,
  isDecisionGate,
  isSamePipeline,
  resolveHandOverPipeline,
  resolveMergeStepKey,
  SHAPE_PIPELINES,
} from '../../packages/core/src/index.ts';
import { HOUR } from '../kit/time.ts';
import {
  CHOSEN_BY_YOU,
  createPlanCheck,
  createSeedClock,
  listSeedCheckResults,
  NO_TRIAGE_DECISIONS,
  NOW,
  type Push,
  resolveAgentSession,
  type SeedClock,
  type SeedRun,
  type SeedTask,
  type TimedSeedEvent,
} from './kit.ts';

function resolveSeedPipeline(task: SeedTask): readonly PipelineStep[] | null {
  if (task.composed) return task.composed.pipeline;
  return task.shape ? SHAPE_PIPELINES[task.shape] : null;
}

export type Timeline = TimedSeedEvent[];

export const SMALL_PLAN = [
  { title: 'Find the cause', detail: 'Reproduce it and trace where it goes wrong.' },
  { title: 'Make the change', detail: 'Fix it in the narrowest place that covers every caller.' },
  { title: 'Verify it', detail: 'Run the checks and confirm the behaviour by hand.' },
];

const LARGE_PLAN = [
  { title: 'Read the current code', detail: 'Map what exists and where the change has to land.' },
  { title: 'Build the core change', detail: 'The new behaviour, behind the existing interfaces.' },
  { title: 'Wire it into the app', detail: 'Connect the screens and commands that use it.' },
  { title: 'Test and capture evidence', detail: 'Tests for the logic, recordings for anything visible.' },
];

const LIVE_STAGES = new Set<TaskStage>([
  'planning',
  'building',
  'reviewing',
  'fixing',
  'investigating',
  'researching',
  'operating',
]);

const BUILT_STAGES = new Set<TaskStage>([
  'checking',
  'awaiting_review',
  'shipping',
  'awaiting_merge',
  'merged',
  'awaiting_operation',
]);

function resolveDefaultVerification(task: SeedTask, phases: number) {
  if (!(resolveSeedPipeline(task)?.includes('build') ?? true)) return [];
  if (task.verification) return task.verification;
  const area = task.branch.split('/').at(-1) ?? task.id;
  return [
    createPlanCheck(
      'Tests for the change',
      `bun test test/${area}`,
      Array.from({ length: phases }, (_, index) => index + 1)
    ),
  ];
}

function resolveSeedPlan(task: SeedTask): PlanDocument {
  if (task.plan) return task.plan;
  const phases = task.size === 'large' ? LARGE_PLAN : SMALL_PLAN;
  return {
    goal: task.request,
    phases,
    behaviour: [],
    approach: 'Planned by the agent.',
    files: [],
    outOfScope: [],
    verification: resolveDefaultVerification(task, phases.length),
    questions: [],
  };
}

function listTaskCheckResults(task: SeedTask) {
  const checks = [...resolveSeedPlan(task).verification, ...(task.addedChecks ?? [])];
  return listSeedCheckResults(checks, task.repo, task.checkResults);
}

function pushAddedChecks(task: SeedTask, phase: number, push: Push, clock: SeedClock) {
  const planned = resolveSeedPlan(task).verification.length;
  for (const [index, added] of (task.addedChecks ?? []).entries()) {
    if (added.phase !== phase) continue;
    push(clock.step(0.1), {
      type: 'checks.changed',
      taskId: task.id,
      runId: `${task.id}-run-${added.run}`,
      changes: [
        {
          action: 'add',
          check: {
            id: `c${planned + index + 1}`,
            label: added.label,
            command: added.command,
            phases: [...added.phases],
            source: 'agent',
          },
          reason: added.reason,
        },
      ],
    });
  }
}

function pushTaskStart(task: SeedTask, push: Push, clock: SeedClock) {
  push(clock.at, {
    type: 'task.created',
    taskId: task.id,
    request: task.request,
    repoId: task.repo.id,
    priority: task.priority ?? 'normal',
    planFirst: task.planFirst ?? false,
    origin: null,
    ...(task.forkOf ? { forkOf: task.forkOf } : {}),
    ...(task.createdBy ? { createdBy: task.createdBy } : {}),
    ...(task.watchHome ? { watchHome: true } : {}),
    ...(task.sourceReport ? { sourceReport: task.sourceReport } : {}),
    ...(task.sourceReport?.scheduleId ? { scheduleId: task.sourceReport.scheduleId } : {}),
    ...(task.shape && !task.auto?.shape ? { shape: task.shape } : {}),
    auto: task.auto ?? CHOSEN_BY_YOU,
  });
  push(clock.step(0.2), {
    type: 'task.triaged',
    taskId: task.id,
    title: task.title,
    repoId: task.repo.id,
    size: task.size,
    branch: task.branch,
    ...(task.shape ? { pipeline: [...SHAPE_PIPELINES[task.shape]] } : {}),
    decisions: task.decisions ?? NO_TRIAGE_DECISIONS,
  });
  if (task.composed) {
    push(clock.step(0.1), {
      type: 'task.reshaped',
      taskId: task.id,
      pipeline: task.composed.pipeline,
      by: 'agent',
      reason: task.composed.why,
    });
  }
  if (task.waitsOn) {
    push(clock.step(0.05), {
      type: 'task.waits_on_changed',
      taskId: task.id,
      waitsOn: task.waitsOn,
      by: 'you',
    });
  }
  if (task.worktreePath) {
    push(clock.step(0.1), {
      type: 'worktree.created',
      taskId: task.id,
      path: task.worktreePath,
      branch: task.branch,
      workspace: 'worktrees',
    });
  }
}

function resolveRunModel(task: SeedTask, role: RunRole) {
  if (task.provider === 'codex') return 'gpt-6-astra';
  return role === 'reviewer' ? 'claude-sonnet-5-5' : 'claude-opus-5-5';
}

function pushTaskRevision(task: SeedTask, push: Push, clock: SeedClock) {
  if (!task.revision) return;
  const gateId = `${task.id}-review-1`;
  push(clock.step(0.5), {
    type: 'gate.opened',
    gate: {
      id: gateId,
      taskId: task.id,
      type: 'review',
      status: 'open',
      title: `Review “${task.title}”`,
      body: 'Built, checked and reviewed by the agents.',
      runId: null,
      openedAt: clock.at,
      answeredAt: null,
      decision: null,
      response: null,
    },
  });
  push(clock.step(20), {
    type: 'gate.answered',
    gateId,
    decision: 'revise',
    response: task.revision.response,
  });
  push(clock.step(0.1), { type: 'fix.started', taskId: task.id, round: 1, reason: 'you' });
}

function pushTaskReview(task: SeedTask, push: Push, clock: SeedClock) {
  if (!task.review) return;
  const gateId = `${task.id}-review-approved`;
  push(clock.step(0.2), {
    type: 'gate.opened',
    gate: {
      id: gateId,
      taskId: task.id,
      type: 'review',
      status: 'open',
      title: `Review “${task.title}”`,
      body: 'Built, checked and reviewed by the agents.',
      runId: null,
      openedAt: clock.at,
      answeredAt: null,
      decision: null,
      response: null,
    },
  });
  push(clock.step(task.review.minutes), {
    type: 'gate.answered',
    gateId,
    decision: 'approve',
    response: null,
  });
}

interface SeedProgress {
  plan: PlanDocument | null;
  finished: number;
  proposed: boolean;
  built: number;
  fixes: number;
  agentRuns: number;
}

function resolveProposedPlan(task: SeedTask) {
  const planning = task.stage === 'triage' || task.stage === 'waiting_on_tasks' || task.stage === 'planning';
  const inquiring = ['answering', 'researching', 'investigating', 'awaiting_proposal'].includes(task.stage);
  if (planning || inquiring) return null;
  const pipeline = resolveSeedPipeline(task);
  if (pipeline && !pipeline.includes('plan')) return null;
  return resolveSeedPlan(task);
}

function resolveFinishedPhases(task: SeedTask, plan: PlanDocument) {
  if (BUILT_STAGES.has(task.stage)) return plan.phases.length;
  if (task.stage === 'building') return Math.floor(plan.phases.length / 2);
  return 0;
}

function pushPlanProposal(task: SeedTask, progress: SeedProgress, push: Push, clock: SeedClock) {
  if (!progress.plan || progress.proposed) return;
  const { plan } = progress;
  push(clock.step(0.2), { type: 'plan.proposed', taskId: task.id, body: plan.goal, document: plan });
  progress.proposed = true;
}

function pushPhaseDone(task: SeedTask, progress: SeedProgress, push: Push, clock: SeedClock) {
  const index = progress.built;
  const phase = progress.plan?.phases[index];
  push(clock.step(2), {
    type: 'phase.completed',
    taskId: task.id,
    report: {
      index,
      summary: task.report?.sections[index]?.summary ?? phase?.detail ?? 'Done.',
      spots: task.report?.sections[index]?.spots ?? [],
      judgementCalls: index === 0 ? (task.report?.judgementCalls ?? []) : [],
      walkthrough:
        index === (progress.plan?.phases.length ?? 1) - 1 ? (task.report?.walkthrough ?? null) : null,
      at: 0,
    },
  });
  push(clock.step(0), { type: 'phase.updated', taskId: task.id, index, status: 'done' });
  pushAddedChecks(task, index + 1, push, clock);
  progress.built += 1;
}

function resolveRunPhase(progress: SeedProgress, run: SeedRun) {
  if (run.purpose !== 'build') return {};
  const last = (progress.plan?.phases.length ?? 1) - 1;
  return { phaseIndex: Math.min(progress.built, last) };
}

function pushFixStart(task: SeedTask, index: number, progress: SeedProgress, push: Push, clock: SeedClock) {
  const run = task.runs?.[index];
  if (run?.purpose !== 'fix') return;
  progress.fixes += 1;
  if (index - 1 === task.revision?.afterRun) return;
  push(clock.step(0.1), {
    type: 'fix.started',
    taskId: task.id,
    round: progress.fixes,
    reason: run.fix ?? 'checks',
  });
}

function pushTaskRun(task: SeedTask, index: number, progress: SeedProgress, push: Push, clock: SeedClock) {
  const run = task.runs?.[index];
  if (!run) return;
  const runId = `${task.id}-run-${index}`;
  const agent = run.role === 'agent';
  clock.step(run.afterMinutes ?? 0);
  pushFixStart(task, index, progress, push, clock);
  push(clock.step(0.5), {
    type: 'run.started',
    run: {
      id: runId,
      taskId: task.id,
      role: run.role,
      ...(run.purpose ? { purpose: run.purpose } : {}),
      ...resolveRunPhase(progress, run),
      provider: task.provider ?? 'claude',
      model: resolveRunModel(task, run.role),
      sessionId: agent ? resolveAgentSession(task.id) : `session-${runId}`,
      sessionProvider: task.provider ?? 'claude',
      ...(agent && progress.agentRuns > 0 ? { resume: true } : {}),
      startedAt: clock.at,
      endedAt: null,
      outcome: null,
      summary: null,
      status: 'running',
    },
  });
  if (agent) progress.agentRuns += 1;
}

function pushTaskRuns(task: SeedTask, push: Push, clock: SeedClock) {
  const runs = task.runs ?? [];
  const plan = resolveProposedPlan(task);
  const progress: SeedProgress = {
    plan,
    finished: plan ? resolveFinishedPhases(task, plan) : 0,
    proposed: false,
    built: 0,
    fixes: 0,
    agentRuns: 0,
  };
  if (!runs.some((run) => run.purpose === 'plan')) pushPlanProposal(task, progress, push, clock);
  for (const [index, run] of runs.entries()) {
    const live = index === runs.length - 1 && !run.failed && LIVE_STAGES.has(task.stage);
    if (live && run.purpose === 'build') {
      while (progress.built < progress.finished) pushPhaseDone(task, progress, push, clock);
    }
    pushTaskRun(task, index, progress, push, clock);
    if (live) continue;
    push(clock.step(run.minutes), {
      type: 'run.ended',
      runId: `${task.id}-run-${index}`,
      outcome: run.failed ? 'failed' : 'completed',
      summary: run.summary,
    });
    if (run.purpose === 'plan' && !run.failed) pushPlanProposal(task, progress, push, clock);
    if (run.purpose === 'build' && !run.failed && progress.built < progress.finished) {
      pushPhaseDone(task, progress, push, clock);
    }
    if (index === task.revision?.afterRun) pushTaskRevision(task, push, clock);
  }
  pushTaskPlan(task, progress, push, clock);
}

function pushTaskPlan(task: SeedTask, progress: SeedProgress, push: Push, clock: SeedClock) {
  pushPlanProposal(task, progress, push, clock);
  while (progress.built < progress.finished) pushPhaseDone(task, progress, push, clock);
  const phases = progress.plan?.phases.length ?? 0;
  if (task.stage === 'building' && progress.finished < phases) {
    push(clock.step(1), {
      type: 'phase.updated',
      taskId: task.id,
      index: progress.finished,
      status: 'active',
    });
  }
}

function resolveSeedPullRequest(task: SeedTask, at: number): PullRequest | null {
  if (!task.pullRequest) return null;
  const repository = task.repo.remote?.split(':').at(-1)?.replace('.git', '');
  return {
    number: task.pullRequest.number,
    url: `https://github.com/${repository}/pull/${task.pullRequest.number}`,
    state: task.merged ? 'merged' : 'open',
    checks: task.pullRequest.checks,
    unresolvedComments: task.pullRequest.comments ?? 0,
    mergeable: task.pullRequest.checks === 'passing',
    updatedAt: at,
    ...(task.pullRequest.mergeCommit ? { mergeCommit: task.pullRequest.mergeCommit } : {}),
    ...(task.pullRequest.changes ? { changes: task.pullRequest.changes } : {}),
  };
}

function pushTaskPullRequest(task: SeedTask, push: Push, clock: SeedClock) {
  const opened = resolveSeedPullRequest(task, clock.step(1));
  if (!opened) return;
  const runs = task.pullRequest?.ciRuns;
  if (!runs) {
    push(clock.at, { type: 'pull_request.opened', taskId: task.id, pullRequest: opened });
    return;
  }
  push(clock.at, {
    type: 'pull_request.opened',
    taskId: task.id,
    pullRequest: {
      ...opened,
      state: 'open',
      checks: 'pending',
      mergeable: false,
      checkRuns: runs.map((run) => ({ ...run, status: 'pending' as const })),
    },
  });
  push(clock.step(6), {
    type: 'pull_request.updated',
    taskId: task.id,
    pullRequest: { ...opened, updatedAt: clock.at, checkRuns: runs.map((run) => ({ ...run })) },
  });
}

function pushTaskResults(task: SeedTask, push: Push, clock: SeedClock) {
  const builds = resolveSeedPipeline(task)?.includes('build') ?? true;
  const results = listTaskCheckResults(task);
  if (builds && BUILT_STAGES.has(task.stage) && task.stage !== 'checking') {
    push(clock.step(0.3), { type: 'checks.recorded', taskId: task.id, results });
  }
  if (builds && (task.report || task.summary)) {
    push(clock.step(0.2), {
      type: 'work.submitted',
      taskId: task.id,
      summary: task.summary ?? task.report?.headline ?? '',
      report: task.report ? { ...task.report, checks: results } : null,
    });
  }
  if (task.findings) {
    push(clock.step(0.2), {
      type: 'review.reported',
      taskId: task.id,
      summary: task.reviewSummary ?? null,
      findings: task.findings,
      ...(task.reviewDisagreements ? { disagreements: task.reviewDisagreements } : {}),
    });
  }
  pushTaskPullRequest(task, push, clock);
}

function listSeedMergeSteps(task: SeedTask) {
  return task.report?.walkthrough?.steps ?? [];
}

function pushHandOverSteps(task: SeedTask, push: Push, clock: SeedClock) {
  const steps = listSeedMergeSteps(task);
  if (steps.length === 0) return;
  const pipeline = [...(resolveSeedPipeline(task) ?? SHAPE_PIPELINES.change)];
  const next = resolveHandOverPipeline(pipeline, {
    before: steps.some((step) => step.when === 'pre_merge'),
    after: steps.some((step) => step.when === 'post_merge'),
  });
  if (!isSamePipeline(next, pipeline)) {
    push(clock.step(0.05), {
      type: 'task.reshaped',
      taskId: task.id,
      pipeline: next,
      by: 'shinsa',
      reason: 'The work report lists steps for you around the merge.',
    });
  }
  for (const step of steps.filter((candidate) => task.ticked?.includes(candidate.title))) {
    push(clock.step(0.4), {
      type: 'merge_step.ticked',
      taskId: task.id,
      key: resolveMergeStepKey(step),
      title: step.title,
      done: true,
    });
  }
}

function resolvePostMergeGate(task: SeedTask): SeedTask['gate'] {
  const open = listSeedMergeSteps(task).filter(
    (step) => step.when === 'post_merge' && !task.ticked?.includes(step.title)
  );
  if (!task.merged || open.length === 0) return undefined;
  return {
    type: 'post_merge',
    title: `${open.length} ${open.length === 1 ? 'post-merge step' : 'post-merge steps'} left`,
    body: [
      `Pull request #${task.pullRequest?.number} merged. These steps are yours; tick each once you did it. The task is done once every step is ticked.`,
      '',
      ...open.map((step) => `- [ ] **${step.title}**: ${step.detail}`),
    ].join('\n'),
  };
}

function resolveSeedGateRun(task: SeedTask) {
  const runs = task.runs?.length ?? 0;
  if (!task.gate || isDecisionGate(task.gate) || runs === 0) return null;
  return `${task.id}-run-${runs - 1}`;
}

function pushTaskGate(task: SeedTask, push: Push, clock: SeedClock) {
  const seeded = task.gate ?? resolvePostMergeGate(task);
  if (!seeded) return;
  const gate: Gate = {
    id: `${task.id}-gate`,
    taskId: task.id,
    type: seeded.type,
    status: 'open',
    title: seeded.title,
    body: seeded.body,
    runId: resolveSeedGateRun(task),
    openedAt: clock.at,
    answeredAt: null,
    decision: null,
    response: null,
    ...seeded.details,
  };
  push(clock.at, { type: 'gate.opened', gate });
}

export function pushTask(task: SeedTask, push: Push) {
  const clock = createSeedClock(NOW - task.ageHours * HOUR);
  pushTaskStart(task, push, clock);
  if (task.script) {
    task.script(push, clock);
    return;
  }
  pushTaskRuns(task, push, clock);
  pushTaskResults(task, push, clock);
  pushTaskReview(task, push, clock);
  pushHandOverSteps(task, push, clock);
  if (task.note) push(clock.step(0.1), { type: 'task.noted', taskId: task.id, note: task.note });
  for (const event of task.extra ?? []) push(clock.step(0.1), event);
  for (const { at, event } of task.timed ?? []) push(at, event);
  push(clock.step(0.1), { type: 'task.staged', taskId: task.id, stage: task.stage, reason: task.reason });
  pushTaskGate(task, push, clock);
}
