import { describe, expect, test } from 'bun:test';
import {
  type CommandOf,
  type DomainError,
  isInFocus,
  isListedInFocus,
  isWatchHome,
  resolveQueue,
  resolveReferenceCatalog,
  SCHEDULE_LIMITS,
  type Schedule,
  serializeTaskReferences,
} from '../../src/index.ts';
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

function createIntake() {
  const { harness, repoId, projectId } = createProject();
  write(harness, { source: { projectId, server: 'slack' } });
  const schedule = only(harness);
  const taskId = schedule.target.kind === 'task' ? schedule.target.taskId : '';
  return { harness, repoId, projectId, taskId };
}

function fire(harness: Harness) {
  const schedule = only(harness);
  harness.advance(60 * MINUTE);
  harness.send({ type: 'schedule.fire', scheduleId: schedule.id, dueAt: schedule.nextRunAt ?? 0 });
  return only(harness);
}

function reportIntake(
  harness: Harness,
  taskId: string,
  summary = 'Read 12 messages; nothing new.',
  reached = true
) {
  return harness.send({ type: 'agent.report_intake', runId: harness.activeRun(taskId).id, summary, reached });
}

describe('a schedule that reads a data source', () => {
  test('a watch gets a home of its own that rests at once, with no handle, no triage and no agent', () => {
    const { harness, projectId } = createProject();
    write(harness, { source: { projectId, server: ' slack ' } });
    const schedule = only(harness);
    expect(schedule.source).toEqual({ projectId, server: 'slack' });
    expect(schedule.target.kind).toBe('task');
    const taskId = schedule.target.kind === 'task' ? schedule.target.taskId : '';
    const home = harness.task(taskId);
    expect(home).toMatchObject({
      watchHome: true,
      projectId,
      repoId: null,
      handle: null,
      stage: 'done',
      stageReason: 'waiting for its first read',
    });
    expect(isWatchHome(home)).toBe(true);
    expect(home.request).toBe(`Watches slack for the automation “Feedback intake”: ${FEEDBACK.data}`);
    expect(Object.values(harness.state.runs).filter((run) => run.taskId === taskId)).toHaveLength(0);
    expect(harness.effectsOf('task.triage').some((effect) => effect.taskId === taskId)).toBe(false);
  });

  test('a watch’s home is off every list, takes no messages and is no other schedule’s target', () => {
    const { harness, taskId } = createIntake();
    const home = harness.task(taskId);
    expect(isListedInFocus(harness.state, home, harness.now)).toBe(false);
    expect(isInFocus(harness.state, home, harness.now)).toBe(true);
    const queue = resolveQueue(harness.state, harness.now);
    expect([...queue.working, ...queue.waiting].map((task) => task.id)).not.toContain(taskId);
    expect(resolveReferenceCatalog(harness.state).tasks.map((task) => task.id)).not.toContain(taskId);
    expect(serializeTaskReferences(harness.state, 'Watches')).not.toContain(taskId);
    expect(refusal(() => harness.send({ type: 'task.message', taskId, text: 'Hello?' })).code).toBe(
      'watch_home'
    );
    expect(refusal(() => write(harness, { target: { kind: 'task', taskId } })).code).toBe('watch_home');
    const agentTask = createTask(harness);
    expect(
      refusal(() =>
        harness.send({
          type: 'agent.set_schedule',
          runId: harness.activeRun(agentTask).id,
          scheduleId: null,
          name: null,
          text: 'Nudge it.',
          trigger: { kind: 'interval', everyMinutes: 30 },
          target: { kind: 'task', taskId },
          source: null,
          enabled: null,
          maxRuns: null,
          timeZone: 'UTC',
        })
      ).code
    ).toBe('watch_home');
    fire(harness);
    const runId = harness.activeRun(taskId).id;
    harness.send({ type: 'message.deliver', taskId, text: 'Missed steer.' });
    expect(harness.activeRun(taskId).id).toBe(runId);
    expect(harness.task(taskId).stage).toBe('watching');
  });

  test('a question a read asks reaches the queue, though its home is on no task list', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q1',
      question: 'Which channel is #feedback?',
      context: null,
    });
    const queue = resolveQueue(harness.state, harness.now);
    expect(queue.ready.map((entry) => entry.task.id)).toEqual([taskId]);
    expect(queue.ready[0]?.gate.type).toBe('question');
    expect([...queue.working, ...queue.waiting].map((task) => task.id)).not.toContain(taskId);
  });

  test('deleting a watch closes its home, at rest or in the middle of a read', () => {
    const resting = createIntake();
    resting.harness.send({ type: 'schedule.remove', scheduleId: only(resting.harness).id });
    expect(resting.harness.task(resting.taskId)).toMatchObject({ stage: 'cancelled' });
    const reading = createIntake();
    fire(reading.harness);
    reading.harness.send({ type: 'schedule.remove', scheduleId: only(reading.harness).id });
    expect(reading.harness.task(reading.taskId).stage).toBe('cancelled');
    expect(
      Object.values(reading.harness.state.runs).filter(
        (run) => run.taskId === reading.taskId && run.endedAt === null
      )
    ).toHaveLength(0);
  });

  test('an agent’s watch, once accepted, reads an integration of its task’s project in a home of its own', () => {
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
    expect(harness.state.schedules).toEqual({});
    const [suggestion] = Object.values(harness.state.watchSuggestions);
    harness.send({ type: 'watch_suggestion.accept', suggestionId: suggestion?.id ?? '' });
    const schedule = only(harness);
    expect(schedule.source).toEqual({ projectId, server: 'slack' });
    const homeId = schedule.target.kind === 'task' ? schedule.target.taskId : '';
    expect(homeId).not.toBe(taskId);
    expect(harness.task(homeId).watchHome).toBe(true);
    expect(
      refusal(() =>
        harness.send({
          type: 'agent.set_schedule',
          runId: harness.activeRun(taskId).id,
          scheduleId: null,
          name: null,
          text: 'Reports.',
          trigger: { kind: 'interval', everyMinutes: 30 },
          target: { kind: 'task', taskId: null },
          source: 'slack',
          enabled: null,
          maxRuns: null,
          timeZone: 'UTC',
        })
      ).code
    ).toBe('source_target');
  });

  test('a schedule that starts or messages a task cannot become a watch', () => {
    const { harness, projectId } = createProject();
    const taskId = createTask(harness);
    write(harness, { target: { kind: 'task', taskId } });
    expect(
      refusal(() => write(harness, { scheduleId: only(harness).id, source: { projectId, server: 'slack' } }))
        .code
    ).toBe('source_change');
  });

  test('a change that leaves the source out keeps it', () => {
    const { harness, projectId } = createIntake();
    write(harness, { scheduleId: only(harness).id, name: 'Renamed', text: null, trigger: null });
    expect(only(harness)).toMatchObject({ name: 'Renamed', source: { projectId, server: 'slack' } });
  });

  test('is refused for an integration the project does not use, or with a target of its own', () => {
    const { harness, projectId } = createProject();
    const unknown = refusal(() => write(harness, { source: { projectId, server: 'maple' } }));
    expect(unknown.code).toBe('source_not_found');
    expect(unknown.message).toContain('It uses `slack`.');
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
    ).toBe('source_target');
    const otherProject = harness.state.repos[otherRepo]?.projectId ?? '';
    expect(
      refusal(() => write(harness, { source: { projectId: otherProject, server: 'slack' } })).message
    ).toContain('It uses none yet.');
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

  test('a source still unreachable after its tries ends the read as not finished, and the next read covers it again', () => {
    const { harness, taskId } = createIntake();
    fire(harness);
    const finished = only(harness).runs.at(-1)?.at ?? 0;
    reportIntake(harness, taskId);
    fire(harness);
    const runId = harness.activeRun(taskId).id;
    expect(readRunInstruction(harness.activeRun(taskId))).toContain(
      `${SCHEDULE_LIMITS.readAttempts} tries in all`
    );
    reportIntake(harness, taskId, 'slack timed out three times.', false);
    expect(harness.state.runs[runId]).toMatchObject({
      outcome: 'failed',
      summary: 'slack timed out three times.',
    });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'done',
      stageReason: 'could not reach a data source',
    });
    expect(only(harness).lastReadAt).toBe(finished);
  });

  test('every read gets its own recovery, so an earlier crash never makes a later read give up at once', () => {
    const { harness, taskId } = createIntake();
    const crash = () =>
      harness.send({
        type: 'run.end',
        runId: harness.activeRun(taskId).id,
        outcome: 'failed',
        summary: 'The connection dropped.',
        failure: {
          class: 'transport_error',
          message: 'The connection dropped.',
          code: null,
          retryable: true,
          resetAt: null,
        },
      });
    fire(harness);
    crash();
    expect(harness.task(taskId).recoveries).toBe(1);
    reportIntake(harness, taskId);
    fire(harness);
    expect(harness.task(taskId).recoveries).toBe(0);
    const first = harness.activeRun(taskId).id;
    crash();
    expect(harness.activeRun(taskId).id).not.toBe(first);
    expect(harness.activeRun(taskId).purpose).toBe('intake');
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

  test('a fire or a delivery while a read is still going is skipped', () => {
    const { harness, projectId } = createIntake();
    fire(harness);
    expect(fire(harness).runs.at(-1)).toMatchObject({ outcome: 'skipped' });
    write(harness, {
      name: 'Alerts',
      source: { projectId, server: 'slack' },
      trigger: { kind: 'webhook', signature: null, replayKey: null },
    });
    const hook = Object.values(harness.state.schedules).find((schedule) => schedule.name === 'Alerts');
    const deliver = (deliveryId: string) =>
      harness.send({
        type: 'schedule.deliver',
        scheduleId: hook?.id ?? '',
        deliveryId,
        text: 'A new alert.',
        replayKey: null,
      });
    deliver('d1');
    deliver('d2');
    expect(harness.state.schedules[hook?.id ?? '']?.runs.at(-1)).toMatchObject({
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

  test('only an intake turn files reports, and only while its watch exists', () => {
    const { harness, taskId } = createIntake();
    const builder = createTask(harness);
    expect(refusal(() => fileReport(harness, builder)).code).toBe('wrong_step');
    fire(harness);
    harness.replay({ type: 'schedule.removed', scheduleId: only(harness).id });
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

describe('a watch over its cost limit', () => {
  test('pauses its next read at a budget gate, and Continue lets the read go on', () => {
    const { harness, taskId } = createIntake();
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 1 } });
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.6 };
    for (let read = 0; read < 2; read += 1) {
      fire(harness);
      harness.send({ type: 'run.meter', runId: harness.activeRun(taskId).id, usage });
      reportIntake(harness, taskId);
    }
    fire(harness);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', cause: 'budget' });
    expect(fire(harness).runs.at(-1)).toMatchObject({ outcome: 'skipped' });
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null });
    expect(harness.activeRun(taskId)).toMatchObject({ purpose: 'intake' });
    reportIntake(harness, taskId);
    expect(fire(harness).runs.at(-1)).toMatchObject({ outcome: 'sent' });
  });

  function overBudget() {
    const intake = createIntake();
    const { harness, taskId } = intake;
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 1 } });
    fire(harness);
    harness.send({
      type: 'run.meter',
      runId: harness.activeRun(taskId).id,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 2 },
    });
    reportIntake(harness, taskId);
    fire(harness);
    return { ...intake, gateId: harness.openGate(taskId).id };
  }

  test('Continue after its integration left the project rests the home instead of reading', () => {
    const { harness, taskId, projectId, gateId } = overBudget();
    harness.send({ type: 'watch_source.remove', projectId, server: 'slack' });
    harness.send({ type: 'gate.answer', gateId, decision: 'approve', response: null });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'done',
      stageReason: 'no automation reads here any more',
    });
  });
});
