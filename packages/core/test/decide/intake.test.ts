import { describe, expect, test } from 'bun:test';
import { type CommandOf, type DomainError, SCHEDULE_LIMITS, type Schedule } from '../../src/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  readInstruction as readRunInstruction,
  registerRepo,
} from '../harness.ts';

const MINUTE = 60_000;

const FEEDBACK = { server: 'slack', data: 'The #feedback channel of the Superwall workspace' };

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return { code: (error as DomainError).code, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

function only(harness: Harness): Schedule {
  const [first] = Object.values(harness.state.schedules);
  if (!first) throw new Error('no schedule');
  return first;
}

function write(harness: Harness, input: Partial<CommandOf<'schedule.write'>> = {}) {
  return harness.send({
    type: 'schedule.write',
    scheduleId: null,
    name: 'Feedback intake',
    text: 'Bug reports and feature requests about the paywall editor.',
    trigger: { kind: 'interval', everyMinutes: 60 },
    target: null,
    source: null,
    enabled: null,
    maxRuns: null,
    timeZone: 'UTC',
    ...input,
  });
}

function createProject() {
  const harness = createHarness();
  const repoId = registerRepo(harness);
  const projectId = harness.state.repos[repoId]?.projectId ?? '';
  harness.send({ type: 'watch_source.write', projectId, ...FEEDBACK, repoIds: [] });
  return { harness, repoId, projectId };
}

function answerFirst(harness: Harness, taskId: string) {
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Feedback intake',
    repoId: null,
    size: 'small',
    branch: 'intake',
    waitsOn: [],
  });
  harness.send({
    type: 'agent.deliver',
    runId: harness.activeRun(taskId).id,
    step: 'answer',
    body: 'I can read #feedback: 40 messages this week.',
  });
}

function createIntake() {
  const { harness, repoId, projectId } = createProject();
  write(harness, { source: { projectId, server: 'slack' } });
  const schedule = only(harness);
  const taskId = schedule.target.kind === 'task' ? schedule.target.taskId : '';
  answerFirst(harness, taskId);
  return { harness, repoId, projectId, taskId };
}

function fire(harness: Harness) {
  const schedule = only(harness);
  harness.advance(60 * MINUTE);
  harness.send({ type: 'schedule.fire', scheduleId: schedule.id, dueAt: schedule.nextRunAt ?? 0 });
  return only(harness);
}

function reportIntake(harness: Harness, taskId: string, summary = 'Read 12 messages; nothing new.') {
  return harness.send({ type: 'agent.report_intake', runId: harness.activeRun(taskId).id, summary });
}

describe('a schedule that reads a data source', () => {
  test('written without a target, it creates its intake task, an Ask task that first checks the source', () => {
    const { harness, projectId } = createProject();
    write(harness, { source: { projectId, server: ' slack ' } });
    const schedule = only(harness);
    expect(schedule.source).toEqual({ projectId, server: 'slack' });
    expect(schedule.target.kind).toBe('task');
    const taskId = schedule.target.kind === 'task' ? schedule.target.taskId : '';
    const task = harness.task(taskId);
    expect(task.mode).toBe('ask');
    expect(task.projectId).toBe(projectId);
    expect(task.repoId).toBeNull();
    expect(task.request).toContain('through the MCP server `slack` for the automation “Feedback intake”');
    expect(task.request).toContain(FEEDBACK.data);
  });

  test('an agent’s schedule reads a source of its own task’s project, in its own task', () => {
    const { harness, projectId } = createProject();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.set_schedule',
      runId: harness.activeRun(taskId).id,
      scheduleId: null,
      name: null,
      text: 'Reports about checkout.',
      trigger: { kind: 'interval', everyMinutes: 30 },
      target: null,
      source: 'slack',
      enabled: null,
      maxRuns: null,
      timeZone: 'UTC',
    });
    expect(only(harness)).toMatchObject({
      source: { projectId, server: 'slack' },
      target: { kind: 'task', taskId },
    });
  });

  test('a change that leaves the source out keeps it', () => {
    const { harness, projectId } = createIntake();
    write(harness, { scheduleId: only(harness).id, name: 'Renamed', text: null, trigger: null });
    expect(only(harness)).toMatchObject({ name: 'Renamed', source: { projectId, server: 'slack' } });
  });

  test('is refused for a server the project does not list, a new task on each run, or another project’s task', () => {
    const { harness, projectId } = createProject();
    const unknown = refusal(() => write(harness, { source: { projectId, server: 'maple' } }));
    expect(unknown.code).toBe('source_not_found');
    expect(unknown.message).toContain('It lists `slack`.');
    expect(refusal(() => write(harness, { source: { projectId: 'nope', server: 'slack' } })).code).toBe(
      'project_not_found'
    );
    expect(
      refusal(() =>
        write(harness, {
          source: { projectId, server: 'slack' },
          target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
        })
      ).code
    ).toBe('source_target');
    const otherRepo = registerRepo(harness, 'marketing', 'Marketing');
    const other = createTask(harness, { repoId: otherRepo });
    expect(
      refusal(() =>
        write(harness, { source: { projectId, server: 'slack' }, target: { kind: 'task', taskId: other } })
      ).code
    ).toBe('source_project');
    const otherProject = harness.state.repos[otherRepo]?.projectId ?? '';
    expect(
      refusal(() => write(harness, { source: { projectId: otherProject, server: 'slack' } })).message
    ).toContain('It lists none yet.');
  });

  test('an agent outside any project has no source to read', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness, 'loose', null);
    const taskId = createTask(harness, { repoId });
    expect(harness.task(taskId).projectId).toBeNull();
    const refused = refusal(() =>
      harness.send({
        type: 'agent.set_schedule',
        runId: harness.activeRun(taskId).id,
        scheduleId: null,
        name: null,
        text: 'Reports.',
        trigger: { kind: 'interval', everyMinutes: 30 },
        target: null,
        source: 'slack',
        enabled: null,
        maxRuns: null,
        timeZone: 'UTC',
      })
    );
    expect(refused.code).toBe('project_required');
  });
});

describe('an intake turn', () => {
  test('each fire is a read-only turn of the intake task’s own session, not a new round', () => {
    const { harness, taskId } = createIntake();
    const before = harness.task(taskId).rounds?.length;
    const schedule = fire(harness);
    const run = harness.activeRun(taskId);
    expect(run).toMatchObject({ role: 'agent', purpose: 'intake' });
    expect(harness.task(taskId).stage).toBe('watching');
    expect(harness.task(taskId).rounds?.length).toBe(before);
    expect(schedule.runs.at(-1)).toMatchObject({ outcome: 'sent', taskId });
    expect(schedule.lastRunId).toBe(run.id);
    const prompt = readRunInstruction(run);
    expect(prompt).toContain('the automation “Feedback intake”');
    expect(prompt).toContain('The source: the MCP server `slack` (The #feedback channel');
    expect(prompt).toContain('What to look for: Bug reports and feature requests about the paywall editor.');
    expect(prompt).toContain('This is its first read');
  });

  test('report_intake ends the turn and the task rests again; the next read starts from the last one', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    const runId = harness.activeRun(taskId).id;
    reportIntake(harness, taskId);
    expect(harness.state.runs[runId]).toMatchObject({
      outcome: 'completed',
      summary: 'Read 12 messages; nothing new.',
    });
    expect(harness.task(taskId).stage).toBe('done');
    const last = only(harness).runs.at(-1)?.at ?? 0;
    fire(harness);
    expect(readRunInstruction(harness.activeRun(taskId))).toContain(
      `Its last read was at ${new Date(last).toISOString()}`
    );
  });

  test('a fire while the task is at work is skipped', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    const schedule = fire(harness);
    expect(schedule.runs.at(-1)).toMatchObject({ outcome: 'skipped' });
    reportIntake(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'How many reports came in last week?' });
    expect(harness.task(taskId).stage).not.toBe('done');
    expect(fire(harness).runs.at(-1)).toMatchObject({
      outcome: 'skipped',
      detail: 'The task was at work, so this read was skipped.',
    });
  });

  test('a webhook delivery reads the source with the delivered text as what to look for', () => {
    const { harness, projectId } = createProject();
    write(harness, {
      source: { projectId, server: 'slack' },
      trigger: { kind: 'webhook', signature: null, replayKey: null },
    });
    const schedule = only(harness);
    const taskId = schedule.target.kind === 'task' ? schedule.target.taskId : '';
    answerFirst(harness, taskId);
    harness.send({
      type: 'schedule.deliver',
      scheduleId: schedule.id,
      deliveryId: 'd1',
      text: 'A new message in #feedback.',
      replayKey: null,
    });
    expect(readRunInstruction(harness.activeRun(taskId))).toContain(
      'What to look for: A new message in #feedback.'
    );
  });

  test('a schedule whose source was removed from the project stops', () => {
    const { harness, projectId } = createIntake();
    harness.send({ type: 'watch_source.remove', projectId, server: 'slack' });
    const schedule = fire(harness);
    expect(schedule.stopped).toBe('target_gone');
    expect(schedule.runs.at(-1)?.detail).toBe('Its data source was removed from the project.');
  });

  test('report_intake needs a summary within its limit, and only an intake turn may call it', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    expect(refusal(() => reportIntake(harness, taskId, '  ')).code).toBe('summary_required');
    expect(
      refusal(() => reportIntake(harness, taskId, 'x'.repeat(SCHEDULE_LIMITS.intakeSummary + 1))).code
    ).toBe('summary_too_long');
    const builder = createTask(harness);
    expect(refusal(() => reportIntake(harness, builder)).code).toBe('wrong_step');
  });
});
