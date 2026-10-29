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
    expect(prompt).toContain('No read has finished yet');
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
    expect(only(harness).lastReadAt).toBe(last);
    fire(harness);
    expect(readRunInstruction(harness.activeRun(taskId))).toContain(
      `Its last finished read started at ${new Date(last).toISOString()}`
    );
  });

  test('a read that failed never moves the start of the next one past the last read that finished', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    const finished = only(harness).runs.at(-1)?.at ?? 0;
    reportIntake(harness, taskId);
    fire(harness);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'The agent could not start.',
      failure: {
        class: 'setup_failed',
        message: 'The agent could not start.',
        code: 'spawn_failed',
        retryable: null,
        resetAt: null,
      },
    });
    expect(harness.task(taskId).stageReason).toBe('could not read a data source');
    expect(only(harness).lastReadAt).toBe(finished);
    fire(harness);
    expect(readRunInstruction(harness.activeRun(taskId))).toContain(
      `Its last finished read started at ${new Date(finished).toISOString()}`
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

function fileReport(
  harness: Harness,
  taskId: string,
  input: Partial<Omit<CommandOf<'agent.file_report'>, 'type' | 'runId'>> = {}
) {
  return harness.send({
    type: 'agent.file_report',
    runId: harness.activeRun(taskId).id,
    title: 'Paywall editor loses unsaved changes',
    request: 'Keep unsaved changes in the paywall editor when the tab reloads.',
    reportId: '1730200000.000100',
    link: 'https://superwall.slack.com/archives/C1/p1730200000000100',
    author: 'Dana',
    postedAt: '2026-10-29T10:00:00Z',
    text: 'I lost an hour of edits when the tab reloaded.\nAgain today.',
    forkOf: null,
    repoId: null,
    ...input,
  });
}

function listFiled(harness: Harness) {
  return Object.values(harness.state.tasks).filter((task) => task.sourceReport);
}

describe('filing reports from an intake turn', () => {
  test('files a task in the project with the report kept on it and quoted in its request', () => {
    const { harness, taskId, projectId } = createIntake();
    fire(harness);
    const runId = harness.activeRun(taskId).id;
    fileReport(harness, taskId);
    const [filed] = listFiled(harness);
    if (!filed) throw new Error('nothing filed');
    expect(filed.projectId).toBe(projectId);
    expect(filed.repoId).toBeNull();
    expect(filed.scheduleId).toBe(only(harness).id);
    expect(filed.createdBy).toEqual({
      kind: 'intake',
      taskId,
      runId,
      requestKey: 'https://superwall.slack.com/archives/C1/p1730200000000100',
    });
    expect(filed.sourceReport).toEqual({
      scheduleId: only(harness).id,
      server: 'slack',
      reportId: '1730200000.000100',
      link: 'https://superwall.slack.com/archives/C1/p1730200000000100',
      author: 'Dana',
      postedAt: '2026-10-29T10:00:00Z',
      text: 'I lost an hour of edits when the tab reloaded.\nAgain today.',
    });
    expect(filed.request).toBe(
      [
        'Paywall editor loses unsaved changes',
        '',
        'Keep unsaved changes in the paywall editor when the tab reloads.',
        '',
        'Reported in slack by Dana on 2026-10-29T10:00:00Z (https://superwall.slack.com/archives/C1/p1730200000000100):',
        '',
        '> I lost an hour of edits when the tab reloaded.',
        '> Again today.',
      ].join('\n')
    );
    expect(filed.activity[0]?.text).toBe(
      'Filed by the schedule “Feedback intake” from a report by Dana in slack'
    );
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'agent',
      text: 'Filed a task from a report: Paywall editor loses unsaved changes',
      detail: 'https://superwall.slack.com/archives/C1/p1730200000000100',
      runId,
    });
    expect(harness.activeRun(taskId).id).toBe(runId);
  });

  test('a report already filed, by its id or its link, is refused with the task it became', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    fileReport(harness, taskId);
    const [filed] = listFiled(harness);
    const byId = refusal(() => fileReport(harness, taskId, { link: null }));
    expect(byId.code).toBe('report_filed');
    expect(byId.message).toBe(
      `This report was already filed as ${filed?.handle} “${filed?.title}”. Skip it and go on.`
    );
    expect(refusal(() => fileReport(harness, taskId, { reportId: 'other' })).code).toBe('report_filed');
    harness.send({ type: 'task.cancel', taskId: filed?.id ?? '' });
    expect(refusal(() => fileReport(harness, taskId, { link: ' ' })).code).toBe('report_filed');
    fileReport(harness, taskId, { reportId: 'other', link: null, author: null, postedAt: null });
    expect(listFiled(harness)).toHaveLength(2);
    expect(listFiled(harness).at(-1)?.request).toContain('Reported in slack (id other):');
  });

  test('a report about shipped work is filed as a fork of the task that shipped it', () => {
    const { harness, taskId, repoId } = createIntake();
    const shipped = createTask(harness, { repoId });
    fire(harness);
    fileReport(harness, taskId, { forkOf: shipped, repoId });
    const [filed] = listFiled(harness);
    expect(filed?.forkOf).toBe(shipped);
    expect(filed?.repoId).toBe(repoId);
    expect(
      refusal(() => fileReport(harness, taskId, { reportId: 'x', link: null, forkOf: 'nope' })).code
    ).toBe('task_not_found');
    expect(
      refusal(() => fileReport(harness, taskId, { reportId: 'y', link: null, forkOf: taskId })).code
    ).toBe('fork_intake');
  });

  test('with two automations reading in one task, the report belongs to the one that started this read', () => {
    const { harness, taskId, projectId } = createIntake();
    const first = only(harness);
    fire(harness);
    reportIntake(harness, taskId);
    write(harness, {
      name: 'Webhook intake',
      source: { projectId, server: 'slack' },
      target: { kind: 'task', taskId },
      trigger: { kind: 'webhook', signature: null, replayKey: null },
    });
    const second = Object.values(harness.state.schedules).find((schedule) => schedule.id !== first.id);
    harness.advance(MINUTE);
    harness.send({
      type: 'schedule.deliver',
      scheduleId: second?.id ?? '',
      deliveryId: 'd1',
      text: 'A new message.',
      replayKey: null,
    });
    fileReport(harness, taskId);
    expect(listFiled(harness)[0]?.scheduleId).toBe(second?.id);
  });

  test('a report lands only in a repository of the reading task’s project', () => {
    const { harness, repoId, taskId } = createIntake();
    const elsewhere = registerRepo(harness, 'web', 'Kanna');
    fire(harness);
    expect(refusal(() => fileReport(harness, taskId, { repoId: elsewhere })).code).toBe('repo_project');
    expect(listFiled(harness)).toHaveLength(0);
    fileReport(harness, taskId, { repoId });
    expect(listFiled(harness)[0]?.repoId).toBe(repoId);
  });

  test('a report needs its id or link and its own words', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    expect(refusal(() => fileReport(harness, taskId, { reportId: ' ', link: null })).code).toBe(
      'report_unnamed'
    );
    expect(refusal(() => fileReport(harness, taskId, { text: '  ' })).code).toBe('report_empty');
    expect(listFiled(harness)).toHaveLength(0);
  });

  test('only an intake turn files reports, and only while an automation reads in the task', () => {
    const { harness, taskId } = createIntake();
    const builder = createTask(harness);
    expect(refusal(() => fileReport(harness, builder)).code).toBe('wrong_step');
    fire(harness);
    harness.send({ type: 'schedule.remove', scheduleId: only(harness).id });
    expect(refusal(() => fileReport(harness, taskId)).code).toBe('schedule_not_found');
  });

  test('the next read lists the reports it filed last, newest first', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    fileReport(harness, taskId);
    harness.advance(MINUTE);
    fileReport(harness, taskId, { reportId: 'r2', link: null, title: 'Dark mode toggle is missing' });
    reportIntake(harness, taskId, 'Filed 2.');
    fire(harness);
    const [first, second] = listFiled(harness);
    const prompt = readRunInstruction(harness.activeRun(taskId));
    expect(prompt).toContain(
      [
        'The reports it filed last, newest first:',
        `- ${second?.handle} “Dark mode toggle is missing”: r2`,
        `- ${first?.handle} “Paywall editor loses unsaved changes”: https://superwall.slack.com/archives/C1/p1730200000000100`,
      ].join('\n')
    );
  });

  test('a read that cannot run gives up without a failure gate, and the task rests again', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'The agent could not start.',
      failure: {
        class: 'setup_failed',
        message: 'The agent could not start.',
        code: 'spawn_failed',
        retryable: null,
        resetAt: null,
      },
    });
    expect(
      Object.values(harness.state.gates).filter((gate) => gate.taskId === taskId && gate.status === 'open')
    ).toHaveLength(0);
    expect(harness.task(taskId).stage).toBe('done');
    expect(harness.task(taskId).stageReason).toBe('could not read a data source');
    expect(fire(harness).runs.at(-1)).toMatchObject({ outcome: 'sent' });
    expect(harness.activeRun(taskId).purpose).toBe('intake');
  });

  test('a read that ends without a report is nudged as an intake turn and can still file', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    const first = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: first.id, outcome: 'completed', summary: null });
    const nudged = harness.activeRun(taskId);
    expect(nudged.id).not.toBe(first.id);
    expect(nudged.purpose).toBe('intake');
    fileReport(harness, taskId);
    expect(listFiled(harness)).toHaveLength(1);
  });
});
