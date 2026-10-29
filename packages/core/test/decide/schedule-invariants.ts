import { expect } from 'bun:test';
import {
  isDelegatedRun,
  isTaskSettled,
  listActiveRuns,
  listOpenGates,
  type RunRole,
  SCHEDULE_LIMITS,
  type ScheduleTrigger,
  type ShinsaCommand,
  type ShinsaState,
} from '../../src/index.ts';

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function chance(random: Random, odds: number) {
  return random() < odds;
}

const SCHEDULING_ROLES = new Set<RunRole>(['agent', 'answerer']);

const TRIGGERS: ScheduleTrigger[] = [
  { kind: 'interval', everyMinutes: 1 },
  { kind: 'daily', time: '00:30', weekdays: [] },
  { kind: 'webhook', signature: null, replayKey: '{{body.id}}' },
];

const REF = `secret-ref:${'f'.repeat(32)}`;

function listAgentCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  return listActiveRuns(state).flatMap((run): ShinsaCommand[] => {
    if (!SCHEDULING_ROLES.has(run.role) || isDelegatedRun(run)) return [];
    const own = Object.values(state.schedules).find(
      (schedule) => schedule.createdBy.kind === 'agent' && schedule.createdBy.taskId === run.taskId
    );
    const intake: ShinsaCommand[] =
      run.purpose === 'intake'
        ? [{ type: 'agent.report_intake', runId: run.id, summary: 'Read it; nothing new.' }]
        : [];
    return [
      ...intake,
      {
        type: 'agent.set_schedule',
        runId: run.id,
        scheduleId: own && chance(random, 0.3) ? own.id : null,
        name: null,
        text: 'Check on it again.',
        trigger: pick(random, TRIGGERS) ?? null,
        target: chance(random, 0.5) ? { kind: 'new_task', priority: 'low', mode: 'build' } : null,
        source: null,
        enabled: null,
        maxRuns: pick(random, [null, 2]) ?? null,
        timeZone: 'UTC',
      },
      {
        type: 'agent.request_secret',
        runId: run.id,
        gateId: `secret-${run.id}`,
        label: 'Token',
        reason: 'For the hook.',
      },
      ...(own ? [{ type: 'agent.delete_schedule' as const, runId: run.id, scheduleId: own.id }] : []),
    ];
  });
}

function listClockCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  return Object.values(state.schedules).flatMap((schedule): ShinsaCommand[] => {
    const scheduleId = schedule.id;
    const commands: ShinsaCommand[] = [
      { type: 'schedule.enable', scheduleId, enabled: chance(random, 0.6) },
      { type: 'schedule.remove', scheduleId },
    ];
    if (schedule.nextRunAt !== null) {
      commands.push(
        { type: 'schedule.fire', scheduleId, dueAt: schedule.nextRunAt },
        { type: 'schedule.fire', scheduleId, dueAt: schedule.nextRunAt },
        { type: 'schedule.fail', scheduleId, dueAt: schedule.nextRunAt, deliveryId: null, detail: 'No.' }
      );
    }
    if (schedule.trigger.kind === 'webhook') {
      commands.push(
        {
          type: 'schedule.deliver',
          scheduleId,
          deliveryId: `d-${state.seq}`,
          text: 'A request came in.',
          replayKey: pick(random, [null, 'k1', 'k2']) ?? null,
        },
        { type: 'schedule.fail', scheduleId, dueAt: null, deliveryId: `d-${state.seq}`, detail: 'Too long.' }
      );
    }
    return commands;
  });
}

function listAnswerCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const answers = listOpenGates(state)
    .filter((gate) => gate.secret)
    .map(
      (gate): ShinsaCommand => ({
        type: 'gate.answer',
        gateId: gate.id,
        decision: chance(random, 0.7) ? 'reply' : 'reject',
        response: REF,
      })
    );
  const compactions = Object.values(state.runs).flatMap((run): ShinsaCommand[] =>
    run.endedAt !== null && run.sessionId
      ? [{ type: 'run.compact', runId: run.id, sessionId: run.sessionId }]
      : []
  );
  return [...answers, ...compactions];
}

export function listScheduleCommands(state: ShinsaState, random: Random) {
  return [
    ...listAgentCommands(state, random),
    ...listClockCommands(state, random),
    ...listAnswerCommands(state, random),
  ];
}

export function listScheduleMarks(state: ShinsaState) {
  const schedules = Object.values(state.schedules);
  return [
    Object.values(state.tasks).some((task) => task.scheduleId) ? 'scheduled task' : null,
    Object.values(state.gates).some((gate) => gate.secret && gate.status === 'answered')
      ? 'answered secret'
      : null,
    schedules.some((schedule) => schedule.runs.some((run) => run.outcome === 'skipped'))
      ? 'skipped run'
      : null,
  ];
}

export function assertScheduleInvariants(state: ShinsaState) {
  const live = new Map<string, number>();
  for (const schedule of Object.values(state.schedules)) {
    const context = `schedule ${schedule.id} (${schedule.trigger.kind})`;
    expect(schedule.runs.length, context).toBeLessThanOrEqual(SCHEDULE_LIMITS.runsKept);
    expect(Object.keys(schedule.replayKeys).length, context).toBeLessThanOrEqual(SCHEDULE_LIMITS.replayKeys);
    if (schedule.maxRuns !== null) expect(schedule.runCount, context).toBeLessThanOrEqual(schedule.maxRuns);
    expect(schedule.runs.filter((run) => run.outcome === 'sent').length, context).toBeLessThanOrEqual(
      schedule.runCount
    );
    if (schedule.stopped !== null) {
      expect([schedule.enabled, schedule.nextRunAt], context).toEqual([false, null]);
      continue;
    }
    const owner = schedule.createdBy.kind === 'agent' ? schedule.createdBy.taskId : 'you';
    live.set(owner, (live.get(owner) ?? 0) + 1);
    if (schedule.trigger.kind === 'webhook') expect(schedule.nextRunAt, context).toBeNull();
    else if (schedule.enabled) expect(schedule.nextRunAt, context).not.toBeNull();
  }
  for (const [owner, count] of live) {
    if (owner !== 'you') expect(count, owner).toBeLessThanOrEqual(SCHEDULE_LIMITS.perTask);
  }
}

const WRITE_ODDS = 0.2;

function listReviewerSchedules(state: ShinsaState): ShinsaCommand[] {
  return listActiveRuns(state)
    .filter((run) => run.role === 'reviewer' && !isDelegatedRun(run))
    .map((run) => ({
      type: 'agent.set_schedule',
      runId: run.id,
      scheduleId: null,
      name: 'Recheck',
      text: 'Review it again when the hook fires.',
      trigger: { kind: 'webhook', signature: null, replayKey: null },
      target: null,
      source: null,
      enabled: null,
      maxRuns: null,
      timeZone: 'UTC',
    }));
}

function listUserWrites(state: ShinsaState, random: Random): ShinsaCommand[] {
  const open = Object.values(state.tasks).filter((task) => !isTaskSettled(task));
  const messaged = pick(random, open);
  const existing = pick(random, Object.values(state.schedules));
  const write = {
    type: 'schedule.write' as const,
    name: null,
    text: 'Look at it again.',
    source: null,
    enabled: null,
    maxRuns: pick(random, [null, 3]) ?? null,
    timeZone: 'UTC',
  };
  const project = pick(random, Object.values(state.projects));
  const sourced: ShinsaCommand[] = project
    ? [
        { type: 'watch_source.write', projectId: project.id, server: 'slack', data: 'Feedback', repoIds: [] },
        ...(chance(random, 0.1)
          ? [{ type: 'watch_source.remove' as const, projectId: project.id, server: 'slack' }]
          : []),
        {
          ...write,
          scheduleId: null,
          trigger: pick(random, TRIGGERS) ?? null,
          target: null,
          source: { projectId: project.id, server: 'slack' },
        },
      ]
    : [{ type: 'project.write', project: { name: 'Feedback', color: 'blue' } }];
  return [
    ...sourced,
    {
      ...write,
      scheduleId: null,
      trigger: pick(random, TRIGGERS) ?? null,
      target: messaged
        ? { kind: 'task', taskId: messaged.id }
        : { kind: 'new_task', repoId: 'repo', priority: 'low', mode: 'ask' },
    },
    {
      ...write,
      scheduleId: null,
      trigger: pick(random, TRIGGERS) ?? null,
      target: {
        kind: 'new_task',
        repoId: pick(random, ['repo', 'gone']) ?? null,
        priority: 'low',
        mode: 'build',
      },
    },
    ...(existing
      ? [
          {
            ...write,
            scheduleId: existing.id,
            trigger: pick(random, [null, ...TRIGGERS]) ?? null,
            target: null,
          },
        ]
      : []),
  ];
}

export function selectScheduleWrite(state: ShinsaState, random: Random): ShinsaCommand | null {
  if (!chance(random, WRITE_ODDS)) return null;
  const reviewers = listReviewerSchedules(state);
  if (reviewers.length > 0 && chance(random, 0.5)) return pick(random, reviewers) ?? null;
  return pick(random, listUserWrites(state, random)) ?? null;
}

export function listScheduleWriteMarks(state: ShinsaState) {
  const schedules = Object.values(state.schedules);
  const runs = Object.values(state.runs);
  return [
    schedules.some((schedule) => schedule.createdBy.kind === 'you') ? 'schedule you wrote' : null,
    runs.some((run) => run.purpose === 'intake') ? 'intake turn' : null,
    runs.some((run) => run.purpose === 'intake' && run.outcome === 'completed') ? 'reported intake' : null,
    schedules.some((schedule) => schedule.createdBy.kind === 'you' && schedule.updatedAt > schedule.createdAt)
      ? 'schedule you changed'
      : null,
    schedules.some(
      (schedule) =>
        schedule.createdBy.kind === 'agent' && state.runs[schedule.createdBy.runId]?.role === 'reviewer'
    )
      ? 'reviewer schedule'
      : null,
  ];
}
