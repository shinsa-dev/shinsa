import { describe, expect, test } from 'bun:test';
import {
  type CommandOf,
  type DomainError,
  HOUR_MS,
  listActiveRuns,
  listOpenGates,
  MINUTE_MS,
  replayEventLog,
  resolveTaskProgress,
  serializeTaskDetail,
  type Watchdog,
  type WatchdogSpec,
} from '../../src/index.ts';
import {
  approve,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
  readInstruction,
} from '../harness.ts';

const LATENCY: WatchdogSpec = {
  title: 'Checkout latency',
  check: 'p95 of POST /checkout stays under 400 ms and its error rate under 1%.',
  source: { server: 'maple', data: 'OpenTelemetry traces and logs of the API' },
  sourceRequest: null,
  firstCheckMinutes: 360,
  maxGapHours: 6,
  forHours: 48,
  startsOn: 'merge',
  productionCheck: null,
};

const EVENTS: WatchdogSpec = {
  title: 'Paywall events',
  check: 'paywall_open events keep arriving from Safari and Chrome.',
  source: null,
  sourceRequest: {
    data: 'Product analytics events from the web paywall',
    evidence: 'src/analytics.ts sends paywall_open to PostHog.',
    suggestions: ['PostHog’s official MCP server', 'Composio’s PostHog toolkit'],
  },
  firstCheckMinutes: 720,
  maxGapHours: 12,
  forHours: 24,
  startsOn: 'merge',
  productionCheck: null,
};

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return { code: (error as DomainError).code, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

function handOver(harness: Harness, taskId: string, watchdogs: WatchdogSpec[]) {
  proposePlan(harness, taskId);
  linkSession(harness, taskId, 'agent-session');
  completePhase(harness, taskId);
  harness.send({
    type: 'agent.complete_phase',
    runId: harness.activeRun(taskId).id,
    summary: 'Sped up checkout.',
    spots: [],
    judgementCalls: [],
    walkthrough: {
      approach: 'Cache the price lookup.',
      flow: 'checkout → cache → price',
      risks: [],
      testing: { automated: [], manual: [] },
      watchdogs,
    },
  });
}

function mergeIn(harness: Harness, watchdogs: WatchdogSpec[] = [LATENCY]) {
  const taskId = createTask(harness);
  handOver(harness, taskId, watchdogs);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings: [],
  });
  approve(harness, taskId);
  pushed(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
  return taskId;
}

function mergeWith(watchdogs: WatchdogSpec[] = [LATENCY]) {
  const harness = createHarness();
  return { harness, taskId: mergeIn(harness, watchdogs) };
}

function watchdog(harness: Harness, taskId: string, index = 0): Watchdog {
  const found = harness.task(taskId).watchdogs?.[index];
  if (!found) throw new Error('no watchdog');
  return found;
}

function fire(harness: Harness, taskId: string, index = 0) {
  const current = watchdog(harness, taskId, index);
  harness.advance((current.nextCheckAt ?? harness.now) - harness.now);
  return harness.send({
    type: 'watchdog.fire',
    taskId,
    watchdogId: current.id,
    dueAt: current.nextCheckAt ?? 0,
  });
}

const SLOW_SAFARI = 'https://maple.dev/q/checkout-p95-safari';

function fileByWatch(harness: Harness, taskId: string) {
  const projectId = harness.task(taskId).projectId ?? '';
  harness.send({
    type: 'schedule.write',
    scheduleId: null,
    name: 'Checkout errors',
    text: 'Slow or failing checkouts.',
    trigger: { kind: 'interval', everyMinutes: 60 },
    target: null,
    source: { projectId, server: 'maple' },
    enabled: null,
    maxRuns: null,
    timeZone: 'UTC',
  });
  const [schedule] = Object.values(harness.state.schedules);
  const homeId = schedule?.target.kind === 'task' ? schedule.target.taskId : '';
  harness.advance(60 * MINUTE_MS);
  harness.send({ type: 'schedule.fire', scheduleId: schedule?.id ?? '', dueAt: schedule?.nextRunAt ?? 0 });
  fileIssue(harness, homeId, { title: 'Safari checkout is slow' });
  harness.send({
    type: 'agent.report_read',
    runId: harness.activeRun(homeId).id,
    summary: 'Filed 1.',
    reached: true,
    live: null,
  });
  const [byWatch] = Object.values(harness.state.tasks).filter((task) => task.sourceReport?.scheduleId);
  if (!byWatch) throw new Error('nothing filed');
  return byWatch;
}

function fileIssue(harness: Harness, taskId: string, filing: Partial<CommandOf<'agent.file_report'>> = {}) {
  return harness.send({
    type: 'agent.file_report',
    runId: harness.activeRun(taskId).id,
    title: 'Checkout is slow in Safari',
    request: 'Fix the cache miss on Safari that makes checkout take 1.8 s.',
    reportId: null,
    link: SLOW_SAFARI,
    author: null,
    postedAt: null,
    text: 'p95 of POST /checkout is 1.8 s in Safari since the merge.',
    forkOf: null,
    repoId: null,
    ...filing,
  });
}

function endCheck(
  harness: Harness,
  taskId: string,
  summary: string,
  read: { reached?: boolean; live?: boolean } = {}
) {
  return harness.send({
    type: 'agent.report_read',
    runId: harness.activeRun(taskId).id,
    summary,
    reached: read.reached ?? true,
    live: read.live ?? null,
  });
}

function report(harness: Harness, taskId: string, healthy: boolean) {
  if (!healthy) fileIssue(harness, taskId);
  return endCheck(
    harness,
    taskId,
    healthy ? 'p95 is 210 ms, errors 0.2%.' : 'p95 is 1.8 s in Safari since the merge.'
  );
}

function projectOf(harness: Harness, taskId: string) {
  const repoId = harness.task(taskId).repoId ?? '';
  const projectId = harness.state.repos[repoId]?.projectId ?? '';
  const project = harness.state.projects[projectId];
  if (!project) throw new Error('no project');
  return project;
}

describe('arming watchdogs', () => {
  test('a merge arms the walkthrough’s watchdogs and records the server as a data source of the project', () => {
    const { harness, taskId } = mergeWith([LATENCY, EVENTS]);
    const task = harness.task(taskId);
    expect(task.stage).toBe('merged');
    expect(task.watchdogs?.map((dog) => [dog.title, dog.status])).toEqual([
      ['Checkout latency', 'watching'],
      ['Paywall events', 'needs_source'],
    ]);
    const latency = watchdog(harness, taskId);
    expect(latency.endsAt).toBe((latency.startedAt ?? 0) + 48 * HOUR_MS);
    expect(latency.nextCheckAt).toBe((latency.startedAt ?? 0) + 6 * HOUR_MS);
    expect(projectOf(harness, taskId).watchSources).toEqual([
      {
        server: 'maple',
        data: 'OpenTelemetry traces and logs of the API',
        repoIds: [task.repoId ?? ''],
        addedBy: 'agent',
        addedAt: latency.armedAt,
      },
    ]);
    expect(task.activity.filter((entry) => entry.kind === 'watchdog').map((entry) => entry.text)).toEqual([
      'Started the watchdog “Checkout latency”',
      'The watchdog “Paywall events” waits for a data source',
    ]);
  });

  test('a later command arms nothing twice, and a merge without watchdogs arms none', () => {
    const { harness, taskId } = mergeWith();
    harness.send({ type: 'task.prioritize', taskId, priority: 'high' });
    expect(harness.task(taskId).watchdogs).toHaveLength(1);
    const plain = mergeWith([]);
    expect(plain.harness.task(plain.taskId).watchdogs).toBeUndefined();
  });

  test('a source the project already lists for every repository is not written again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const project = projectOf(harness, taskId);
    harness.send({
      type: 'watch_source.write',
      projectId: project.id,
      server: 'maple',
      data: 'All telemetry',
      repoIds: [],
    });
    handOver(harness, taskId, [LATENCY]);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    approve(harness, taskId);
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    expect(projectOf(harness, taskId).watchSources).toEqual([
      { server: 'maple', data: 'All telemetry', repoIds: [], addedBy: 'you', addedAt: expect.any(Number) },
    ]);
  });
});

describe('a watch check', () => {
  test('runs as a read-only turn of a watch session of its own and goes back to rest after a healthy report', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    expect(harness.task(taskId).stage).toBe('watching');
    expect(run).toMatchObject({ role: 'agent', purpose: 'watch', sessionId: null, resume: false });
    expect(run.prompt).toContain('Sped up checkout.');
    expect(readInstruction(run)).toContain('the watchdog “Checkout latency”');
    expect(readInstruction(run)).toContain('the MCP server `maple`');
    expect(watchdog(harness, taskId).runId).toBe(run.id);
    report(harness, taskId, true);
    const after = watchdog(harness, taskId);
    expect(harness.task(taskId).stage).toBe('merged');
    expect(after).toMatchObject({ status: 'watching', runId: null });
    expect(after.checks).toEqual([
      { at: expect.any(Number), healthy: true, summary: 'p95 is 210 ms, errors 0.2%.' },
    ]);
    expect(after.nextCheckAt).toBe((after.checks[0]?.at ?? 0) + 6 * HOUR_MS);
    expect(listActiveRuns(harness.state, taskId)).toEqual([]);
  });

  test('the next check resumes the watch session, and the Agent’s next round resumes its own, never the watch’s', () => {
    const { harness, taskId } = mergeWith([{ ...LATENCY, forHours: 16 }]);
    fire(harness, taskId);
    linkSession(harness, taskId, 'watch-session');
    report(harness, taskId, true);
    fire(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      purpose: 'watch',
      sessionId: 'watch-session',
      resume: true,
    });
    report(harness, taskId, true);
    harness.send({ type: 'task.message', taskId, text: 'Cache the tax lookup too.', kind: 'new_round' });
    harness.send({ type: 'config.record', taskId, problems: [] });
    harness.send({
      type: 'worktree.ready',
      taskId,
      path: `/wt/${taskId}`,
      branch: harness.task(taskId).branch ?? '',
    });
    expect(harness.activeRun(taskId)).toMatchObject({
      purpose: 'plan',
      sessionId: 'agent-session',
      resume: true,
    });
  });

  test('passes once the next check would fall past its window, and later checks see the earlier ones', () => {
    const { harness, taskId } = mergeWith([{ ...LATENCY, forHours: 16 }]);
    fire(harness, taskId);
    report(harness, taskId, true);
    fire(harness, taskId);
    expect(readInstruction(harness.activeRun(taskId))).toContain('Its last checks:');
    report(harness, taskId, true);
    expect(watchdog(harness, taskId)).toMatchObject({ status: 'passed', nextCheckAt: null });
    expect(harness.task(taskId).activity.at(-2)?.text).toBe(
      'The watchdog “Checkout latency” found nothing wrong'
    );
  });

  test('a check due exactly when the window ends still runs, and its report passes the watchdog', () => {
    const { harness, taskId } = mergeWith([
      { ...LATENCY, firstCheckMinutes: 1440, maxGapHours: 24, forHours: 24 },
    ]);
    expect(watchdog(harness, taskId).nextCheckAt).toBe(watchdog(harness, taskId).endsAt);
    fire(harness, taskId);
    expect(harness.activeRun(taskId).purpose).toBe('watch');
    report(harness, taskId, true);
    expect(watchdog(harness, taskId)).toMatchObject({ status: 'passed', checks: [{ healthy: true }] });
  });

  test('a last check deferred past the window’s end still stops the watchdog when the task is still at work', () => {
    const { harness, taskId } = mergeWith([
      { ...LATENCY, firstCheckMinutes: 1440, maxGapHours: 24, forHours: 24 },
    ]);
    harness.send({ type: 'task.message', taskId, text: 'Add a retry button too.', kind: 'new_round' });
    fire(harness, taskId);
    expect(watchdog(harness, taskId).nextCheckAt).toBe(harness.now + 15 * MINUTE_MS);
    fire(harness, taskId);
    expect(watchdog(harness, taskId)).toMatchObject({ status: 'stopped', checks: [], nextCheckAt: null });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Could not check the watchdog “Checkout latency”, and its window has ended, so it stopped'
    );
  });

  test('a last check deferred past the window’s end runs late once the task rests', () => {
    const { harness, taskId } = mergeWith([
      { ...LATENCY, firstCheckMinutes: 1440, maxGapHours: 24, forHours: 24 },
    ]);
    harness.send({ type: 'task.message', taskId, text: 'Why a cache?', kind: 'feedback' });
    const answerer = harness.activeRun(taskId);
    fire(harness, taskId);
    harness.send({
      type: 'agent.deliver',
      runId: answerer.id,
      step: 'answer',
      body: 'Prices change rarely.',
    });
    expect(harness.task(taskId).stage).toBe('merged');
    fire(harness, taskId);
    expect(harness.activeRun(taskId).purpose).toBe('watch');
    report(harness, taskId, true);
    expect(watchdog(harness, taskId)).toMatchObject({ status: 'passed', checks: [{ healthy: true }] });
  });

  test('a fire for another slot, or for a watchdog that is not watching, does nothing', () => {
    const { harness, taskId } = mergeWith([LATENCY, EVENTS]);
    const latency = watchdog(harness, taskId);
    expect(harness.send({ type: 'watchdog.fire', taskId, watchdogId: latency.id, dueAt: 1 }).events).toEqual(
      []
    );
    const events = watchdog(harness, taskId, 1);
    expect(harness.send({ type: 'watchdog.fire', taskId, watchdogId: events.id, dueAt: 0 }).events).toEqual(
      []
    );
    expect(harness.send({ type: 'watchdog.fire', taskId: 'gone', watchdogId: 'x', dueAt: 0 }).events).toEqual(
      []
    );
  });

  test('waits while the task works on a later round, and checks again a quarter of an hour later', () => {
    const { harness, taskId } = mergeWith();
    harness.send({ type: 'task.message', taskId, text: 'Add a retry button too.', kind: 'new_round' });
    expect(harness.task(taskId).stage).not.toBe('merged');
    fire(harness, taskId);
    const deferred = watchdog(harness, taskId);
    expect(deferred.runId).toBeNull();
    expect(deferred.nextCheckAt).toBe(harness.now + 15 * MINUTE_MS);
  });

  test('a report it files forks the shipped task, and the check that filed it trips the watchdog', () => {
    const { harness, taskId } = mergeWith();
    harness.send({ type: 'task.prioritize', taskId, priority: 'high' });
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    report(harness, taskId, false);
    const tripped = watchdog(harness, taskId);
    expect(tripped).toMatchObject({ status: 'tripped', nextCheckAt: null, runId: null });
    expect(tripped.checks).toEqual([
      { at: expect.any(Number), healthy: false, summary: 'p95 is 1.8 s in Safari since the merge.' },
    ]);
    expect(tripped.forkTaskIds).toHaveLength(1);
    const forked = harness.task(tripped.forkTaskIds[0] ?? '');
    expect(forked).toMatchObject({
      forkOf: taskId,
      repoId: harness.task(taskId).repoId,
      priority: 'high',
      createdBy: { kind: 'watchdog', taskId, runId: run.id, requestKey: SLOW_SAFARI },
      sourceReport: {
        scheduleId: null,
        watchdogId: tripped.id,
        server: 'maple',
        reportId: null,
        link: SLOW_SAFARI,
        author: null,
        postedAt: null,
        text: 'p95 of POST /checkout is 1.8 s in Safari since the merge.',
      },
    });
    expect(forked.request).toContain('Fix the cache miss on Safari');
    expect(forked.request).toContain(`Reported in maple (${SLOW_SAFARI}):`);
    expect(forked.activity[0]?.text).toBe('Filed by the watchdog “Checkout latency” from a report in maple');
    expect(harness.task(taskId).stage).toBe('merged');
    expect(harness.state.runs[run.id]).toMatchObject({
      outcome: 'completed',
      summary: 'Filed 1 report on the change.',
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      `The watchdog “Checkout latency” found an issue and filed ${forked.handle}`
    );
  });

  test('a report this watchdog filed before is refused when it files it again', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    fileIssue(harness, taskId);
    const again = refusal(() => fileIssue(harness, taskId, { title: 'Safari checkout again' }));
    expect(again.code).toBe('report_filed');
    expect(again.message).toContain('“Checkout is slow in Safari”');
    fileIssue(harness, taskId, { link: null, reportId: 'err-42', title: 'Checkout throws in Firefox' });
    expect(refusal(() => fileIssue(harness, taskId, { link: null, reportId: 'err-42' })).code).toBe(
      'report_filed'
    );
    endCheck(harness, taskId, 'Two issues since the merge.');
    expect(watchdog(harness, taskId).forkTaskIds).toHaveLength(2);
  });

  test('a report a watch filed first counts for the check: it trips the watchdog and is linked, not forked', () => {
    const { harness, taskId } = mergeWith();
    const byWatch = fileByWatch(harness, taskId);
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    fileIssue(harness, taskId);
    expect(refusal(() => fileIssue(harness, taskId)).code).toBe('report_filed');
    endCheck(harness, taskId, 'Safari checkout is slow; a watch filed it already.');
    expect(watchdog(harness, taskId)).toMatchObject({
      status: 'tripped',
      forkTaskIds: [],
      linkedTaskIds: [byWatch.id],
      checks: [{ healthy: false }],
    });
    expect(harness.state.runs[run.id]?.summary).toBe('Found 1 report on the change already filed.');
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toEqual(
      expect.arrayContaining([
        `The watchdog “Checkout latency” found a report already filed as ${byWatch.handle}`,
        `The watchdog “Checkout latency” found an issue, already filed as ${byWatch.handle}`,
      ])
    );
    expect(replayEventLog(harness.events).state.tasks[taskId]?.watchdogs).toEqual(
      harness.task(taskId).watchdogs
    );
  });

  test('a check that files one report and finds another already filed names each for what it is', () => {
    const { harness, taskId } = mergeWith();
    const byWatch = fileByWatch(harness, taskId);
    fire(harness, taskId);
    fileIssue(harness, taskId);
    fileIssue(harness, taskId, {
      link: 'https://maple.dev/q/checkout-errors-firefox',
      title: 'Checkout throws in Firefox',
    });
    endCheck(harness, taskId, 'Two issues since the merge.');
    const { forkTaskIds, linkedTaskIds } = watchdog(harness, taskId);
    const fork = harness.task(forkTaskIds[0] ?? '');
    expect(linkedTaskIds).toEqual([byWatch.id]);
    expect(fork.forkOf).toBe(taskId);
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      `The watchdog “Checkout latency” found an issue and filed ${fork.handle}, with ${byWatch.handle} already filed`
    );
  });

  test('a filing needs the report’s id or link and its text, forks only this task and stays in its project', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    expect(refusal(() => fileIssue(harness, taskId, { link: ' ', reportId: null })).code).toBe(
      'report_unnamed'
    );
    expect(refusal(() => fileIssue(harness, taskId, { text: ' ' })).code).toBe('report_empty');
    const other = createTask(harness);
    expect(refusal(() => fileIssue(harness, taskId, { forkOf: other })).code).toBe('fork_watchdog');
    expect(refusal(() => fileIssue(harness, taskId, { repoId: 'elsewhere' })).code).toBe('repo_project');
    fileIssue(harness, taskId, { forkOf: taskId });
    endCheck(harness, taskId, 'Slow in Safari.');
    expect(harness.task(watchdog(harness, taskId).forkTaskIds[0] ?? '').forkOf).toBe(taskId);
  });

  test('a source still unreachable after its tries is a missed check, and the next one stays on schedule', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    expect(readInstruction(run)).toContain('3 tries in all');
    endCheck(harness, taskId, 'maple timed out three times.', { reached: false });
    expect(harness.state.runs[run.id]).toMatchObject({
      outcome: 'failed',
      summary: 'maple timed out three times.',
    });
    expect(watchdog(harness, taskId)).toMatchObject({
      status: 'watching',
      runId: null,
      checks: [],
      nextCheckAt: harness.now + 6 * HOUR_MS,
    });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'merged',
      stageReason: 'could not check a watchdog',
    });
  });

  test('a check that gives up after it filed a report still trips the watchdog', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    fileIssue(harness, taskId);
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
    expect(watchdog(harness, taskId)).toMatchObject({
      status: 'tripped',
      checks: [{ healthy: false, summary: 'The agent could not start.' }],
    });
  });

  test('its prompt is a read of the source since the last check, with the reports filed from it', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    report(harness, taskId, true);
    const checkedAt = harness.now;
    fire(harness, taskId);
    const prompt = readInstruction(harness.activeRun(taskId));
    expect(prompt).toContain('What to look for: p95 of POST /checkout stays under 400 ms');
    expect(prompt).toContain(`Look only at what arrived since ${new Date(checkedAt).toISOString()}.`);
    expect(prompt).toContain('Every task you file forks this one');
    expect(prompt).toContain('call `report_read` with a `summary`');
    fileIssue(harness, taskId);
    endCheck(harness, taskId, 'Slow in Safari.');
    const forked = harness.task(watchdog(harness, taskId).forkTaskIds[0] ?? '');
    const later = mergeIn(harness);
    fire(harness, later);
    expect(readInstruction(harness.activeRun(later))).toContain(
      [
        'The reports filed last from this source, newest first:',
        `- ${forked.handle} “${forked.title}”: ${SLOW_SAFARI}`,
      ].join('\n')
    );
  });

  test('a report with no watchdog waiting on it is refused', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    harness.replay({
      type: 'watchdog.ended',
      taskId,
      watchdogId: watchdog(harness, taskId).id,
    });
    expect(refusal(() => fileIssue(harness, taskId)).code).toBe('watchdog_not_found');
    expect(refusal(() => endCheck(harness, taskId, 'ok')).code).toBe('watchdog_not_found');
  });

  test('a message while it checks steers it, and a retry starts the check again', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    const first = harness.activeRun(taskId);
    harness.send({ type: 'task.message', taskId, text: 'Look at Safari only.', kind: 'feedback' });
    expect(harness.lastEffect('run.steer')).toMatchObject({ runId: first.id });
    harness.send({ type: 'task.retry', taskId });
    const again = harness.activeRun(taskId);
    expect(again.id).not.toBe(first.id);
    expect(again.purpose).toBe('watch');
    expect(watchdog(harness, taskId).runId).toBe(again.id);
  });

  test('a check that cannot run gives up without a failure gate, and the next slot still checks', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    const failed = harness.activeRun(taskId);
    harness.send({
      type: 'run.end',
      runId: failed.id,
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
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).stage).toBe('merged');
    expect(watchdog(harness, taskId)).toMatchObject({
      status: 'watching',
      runId: null,
      nextCheckAt: harness.now + 6 * HOUR_MS,
      checks: [],
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'Could not check the watchdog “Checkout latency”; it tries again at its next check'
    );
    fire(harness, taskId);
    expect(harness.activeRun(taskId).purpose).toBe('watch');
  });

  test('a check that keeps ending without a report gives up after its nudges, and stops when no slot is left', () => {
    const { harness, taskId } = mergeWith([
      { ...LATENCY, firstCheckMinutes: 1800, maxGapHours: 24, forHours: 48 },
    ]);
    fire(harness, taskId);
    const first = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: first.id, outcome: 'completed', summary: null });
    const nudged = harness.activeRun(taskId);
    expect(nudged.id).not.toBe(first.id);
    expect(watchdog(harness, taskId).runId).toBe(nudged.id);
    for (let attempt = 0; attempt < 10 && listActiveRuns(harness.state, taskId).length > 0; attempt += 1) {
      harness.send({
        type: 'run.end',
        runId: harness.activeRun(taskId).id,
        outcome: 'completed',
        summary: null,
      });
    }
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(watchdog(harness, taskId)).toMatchObject({
      runId: null,
      nextCheckAt: null,
      status: 'stopped',
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'Could not check the watchdog “Checkout latency”, and its window has ended, so it stopped'
    );
  });

  test('a check resumed after a usage limit reset can still report', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'Claude’s usage limit is reached.',
      failure: {
        class: 'usage_limit',
        message: 'Claude’s usage limit is reached.',
        code: 'rate_limit',
        retryable: true,
        resetAt: harness.now + HOUR_MS,
        account: null,
      },
    });
    harness.send({ type: 'usage_wait.resume_now', taskId });
    expect(watchdog(harness, taskId).runId).toBe(harness.activeRun(taskId).id);
    report(harness, taskId, true);
    expect(watchdog(harness, taskId).checks).toHaveLength(1);
  });

  test('a retry while watching with no check left goes back to rest', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    harness.replay({
      type: 'watchdog.ended',
      taskId,
      watchdogId: watchdog(harness, taskId).id,
    });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.task(taskId).stage).toBe('merged');
  });
});

const DEFAULTED: WatchdogSpec = { ...LATENCY, firstCheckMinutes: null, maxGapHours: null, forHours: null };

const RELEASED: WatchdogSpec = {
  ...LATENCY,
  startsOn: 'production',
  productionCheck: 'The production deployment on Vercel includes the merge commit.',
};

function reportLive(harness: Harness, taskId: string, live: boolean) {
  return endCheck(
    harness,
    taskId,
    live ? 'Live in production; p95 is 210 ms.' : 'Production still runs the previous release.',
    { live }
  );
}

describe('a watchdog’s schedule', () => {
  test('takes the settings’ defaults: the first check after 30 minutes, then gaps that double up to 6 hours, for 72 hours', () => {
    const { harness, taskId } = mergeWith([DEFAULTED]);
    const armed = watchdog(harness, taskId);
    expect(armed).toMatchObject({ firstCheckMinutes: 30, maxGapMinutes: 360, forMinutes: 72 * 60 });
    expect(armed.nextCheckAt).toBe(harness.now + 30 * MINUTE_MS);
    expect(armed.endsAt).toBe(harness.now + 72 * HOUR_MS);
    const gaps: number[] = [];
    for (let check = 0; check < 5; check += 1) {
      fire(harness, taskId);
      report(harness, taskId, true);
      gaps.push(((watchdog(harness, taskId).nextCheckAt ?? 0) - harness.now) / MINUTE_MS);
    }
    expect(gaps).toEqual([60, 120, 240, 360, 360]);
  });

  test('a change to the settings applies to the watchdogs armed after it', () => {
    const harness = createHarness();
    harness.send({
      type: 'settings.change',
      patch: { watchdogHours: 24, watchdogFirstCheckMinutes: 10, watchdogMaxGapHours: 2 },
    });
    expect(harness.state.settings).toMatchObject({ watchdogHours: 24, watchdogFirstCheckMinutes: 10 });
    expect(() => harness.send({ type: 'settings.change', patch: { watchdogHours: 0 } })).toThrow(
      'Watchdogs watch for 1 to 720 hours.'
    );
    expect(() => harness.send({ type: 'settings.change', patch: { watchdogMaxGapHours: 25 } })).toThrow(
      'Checks are at most 1 to 24 hours apart.'
    );
  });

  test('the agent’s own schedule wins over the defaults', () => {
    const { harness, taskId } = mergeWith([
      { ...DEFAULTED, firstCheckMinutes: 5, maxGapHours: 1, forHours: 12 },
    ]);
    expect(watchdog(harness, taskId)).toMatchObject({
      firstCheckMinutes: 5,
      maxGapMinutes: 60,
      forMinutes: 720,
      nextCheckAt: harness.now + 5 * MINUTE_MS,
    });
  });
});

describe('a watchdog that starts on production', () => {
  test('waits after the merge and asks every half hour whether the change is live', () => {
    const { harness, taskId } = mergeWith([RELEASED]);
    expect(watchdog(harness, taskId)).toMatchObject({
      status: 'awaiting_production',
      startedAt: null,
      endsAt: null,
      nextCheckAt: harness.now + 30 * MINUTE_MS,
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'The watchdog “Checkout latency” waits for the change to reach production'
    );
    fire(harness, taskId);
    const prompt = readInstruction(harness.activeRun(taskId));
    expect(prompt).toContain('is live in production yet');
    expect(prompt).toContain('How to tell: The production deployment on Vercel includes the merge commit.');
    expect(harness.activeRun(taskId).purpose).toBe('watch');
  });

  test('a check that does not say whether it is live is refused, and one that is not live asks again later', () => {
    const { harness, taskId } = mergeWith([RELEASED]);
    fire(harness, taskId);
    expect(refusal(() => report(harness, taskId, true)).code).toBe('live_required');
    reportLive(harness, taskId, false);
    expect(harness.task(taskId).stage).toBe('merged');
    expect(watchdog(harness, taskId)).toMatchObject({
      status: 'awaiting_production',
      runId: null,
      checks: [],
    });
    expect(Math.round(((watchdog(harness, taskId).nextCheckAt ?? 0) - harness.now) / MINUTE_MS)).toBe(30);
  });

  test('asks less often the longer it waits: the gap doubles from half an hour to six hours', () => {
    const { harness, taskId } = mergeWith([RELEASED]);
    const gaps: number[] = [];
    for (let ask = 0; ask < 7; ask += 1) {
      fire(harness, taskId);
      reportLive(harness, taskId, false);
      gaps.push(Math.round(((watchdog(harness, taskId).nextCheckAt ?? 0) - harness.now) / MINUTE_MS));
    }
    expect(gaps).toEqual([30, 60, 120, 240, 360, 360, 360]);
  });

  test('one answer counts for every watchdog of the task that waits for production', () => {
    const { harness, taskId } = mergeWith([RELEASED, { ...RELEASED, title: 'Checkout errors' }]);
    fire(harness, taskId);
    fire(harness, taskId, 1);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(1);
    expect(watchdog(harness, taskId, 1).runId).toBeNull();
    reportLive(harness, taskId, false);
    expect(watchdog(harness, taskId, 1).nextCheckAt).toBe(watchdog(harness, taskId).nextCheckAt);
    fire(harness, taskId);
    reportLive(harness, taskId, true);
    expect(watchdog(harness, taskId, 1)).toMatchObject({
      status: 'watching',
      startedAt: harness.now,
      checks: [],
      nextCheckAt: harness.now + 360 * MINUTE_MS,
    });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('once live, the window starts then and the first check is recorded', () => {
    const { harness, taskId } = mergeWith([RELEASED]);
    fire(harness, taskId);
    reportLive(harness, taskId, true);
    const live = watchdog(harness, taskId);
    expect(live).toMatchObject({
      status: 'watching',
      startedAt: harness.now,
      endsAt: harness.now + 48 * HOUR_MS,
      checks: [{ healthy: true }],
      nextCheckAt: harness.now + 6 * HOUR_MS,
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'The change is live in production, so the watchdog “Checkout latency” started watching'
    );
  });

  test('a report filed while it waits counts as live, and saying not live after one is refused', () => {
    const { harness, taskId } = mergeWith([RELEASED]);
    fire(harness, taskId);
    fileIssue(harness, taskId);
    expect(refusal(() => reportLive(harness, taskId, false)).code).toBe('live_filed');
    endCheck(harness, taskId, 'Live, and checkout is slow in Safari.');
    expect(watchdog(harness, taskId)).toMatchObject({
      status: 'tripped',
      startedAt: harness.now,
      checks: [{ healthy: false }],
    });
  });

  test('a source it cannot reach while it waits is a missed check, and it keeps waiting', () => {
    const { harness, taskId } = mergeWith([RELEASED]);
    fire(harness, taskId);
    endCheck(harness, taskId, 'Vercel did not answer.', { reached: false });
    const waiting = watchdog(harness, taskId);
    expect(waiting).toMatchObject({ status: 'awaiting_production', runId: null, checks: [] });
    expect(waiting.nextCheckAt).toBeGreaterThanOrEqual(harness.now + 30 * MINUTE_MS);
  });

  test('stops waiting after a week without reaching production', () => {
    const { harness, taskId } = mergeWith([RELEASED]);
    fire(harness, taskId);
    harness.advance(168 * HOUR_MS);
    reportLive(harness, taskId, false);
    expect(watchdog(harness, taskId)).toMatchObject({ status: 'stopped', nextCheckAt: null });
    expect(harness.task(taskId).activity.map((entry) => entry.detail)).toContain(
      'The change did not reach production within 168 hours, so the watchdog stopped waiting.'
    );
  });

  test('a source connected later starts it waiting for production too', () => {
    const { harness, taskId } = mergeWith([
      { ...RELEASED, source: null, sourceRequest: EVENTS.sourceRequest },
    ]);
    harness.send({
      type: 'watchdog.connect',
      taskId,
      watchdogId: watchdog(harness, taskId).id,
      server: 'maple',
      data: 'Traces',
    });
    expect(watchdog(harness, taskId)).toMatchObject({
      status: 'awaiting_production',
      startedAt: null,
      awaitingSince: harness.now,
      nextCheckAt: harness.now + 30 * MINUTE_MS,
    });
  });

  test('a source connected days later still waits a full week for production from then', () => {
    const { harness, taskId } = mergeWith([
      { ...RELEASED, source: null, sourceRequest: EVENTS.sourceRequest },
    ]);
    harness.advance(160 * HOUR_MS);
    harness.send({
      type: 'watchdog.connect',
      taskId,
      watchdogId: watchdog(harness, taskId).id,
      server: 'maple',
      data: 'Traces',
    });
    fire(harness, taskId);
    harness.advance(24 * HOUR_MS);
    reportLive(harness, taskId, false);
    expect(watchdog(harness, taskId).status).toBe('awaiting_production');
  });
});

describe('watchdogs on the task’s steps', () => {
  test('a Watching step follows the merge, current while one watches and done once they all end', () => {
    const { harness, taskId } = mergeWith([
      { ...LATENCY, firstCheckMinutes: 1440, maxGapHours: 24, forHours: 24 },
    ]);
    const watching = resolveTaskProgress(harness.task(taskId));
    expect(watching.phases.at(-1)).toMatchObject({
      key: 'watch',
      title: 'Watching',
      status: 'active',
      count: { done: 0, total: 1 },
    });
    expect(watching.current?.key).toBe('watch');
    fire(harness, taskId);
    expect(harness.task(taskId).stage).toBe('watching');
    const checking = resolveTaskProgress(harness.task(taskId));
    expect(checking.phases.filter((phase) => phase.status === 'active').map((phase) => phase.key)).toEqual([
      'watch',
    ]);
    report(harness, taskId, true);
    const passed = resolveTaskProgress(harness.task(taskId));
    expect(passed.phases.at(-1)).toMatchObject({
      key: 'watch',
      status: 'done',
      count: { done: 1, total: 1 },
    });
    expect(passed.current).toBeNull();
  });

  test('a task without watchdogs has no Watching step', () => {
    const { harness, taskId } = mergeWith([]);
    expect(resolveTaskProgress(harness.task(taskId)).phases.map((phase) => phase.key)).not.toContain('watch');
  });
});

describe('connecting a source', () => {
  test('starts a watchdog that waited for one and adds the server to the project for this repository', () => {
    const { harness, taskId } = mergeWith([EVENTS]);
    const waiting = watchdog(harness, taskId);
    harness.send({
      type: 'watchdog.connect',
      taskId,
      watchdogId: waiting.id,
      server: ' posthog ',
      data: 'Web analytics events',
    });
    const started = watchdog(harness, taskId);
    expect(started).toMatchObject({
      status: 'watching',
      source: { server: 'posthog', data: 'Web analytics events' },
      startedAt: harness.now,
      endsAt: harness.now + 24 * HOUR_MS,
      nextCheckAt: harness.now + 12 * HOUR_MS,
    });
    expect(projectOf(harness, taskId).watchSources?.[0]).toMatchObject({
      server: 'posthog',
      addedBy: 'you',
      repoIds: [harness.task(taskId).repoId],
    });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Connected posthog to the watchdog “Paywall events”'
    );
    expect(
      refusal(() =>
        harness.send({ type: 'watchdog.connect', taskId, watchdogId: waiting.id, server: 'x', data: 'y' })
      ).code
    ).toBe('watchdog_has_source');
    expect(
      refusal(() =>
        harness.send({ type: 'watchdog.connect', taskId, watchdogId: 'nope', server: 'x', data: 'y' })
      ).code
    ).toBe('watchdog_not_found');
  });
});

describe('stopping watchdogs', () => {
  test('stop ends one, and stopping it during its check ends the check too', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    harness.send({ type: 'watchdog.stop', taskId, watchdogId: watchdog(harness, taskId).id });
    expect(watchdog(harness, taskId)).toMatchObject({ status: 'stopped', runId: null });
    expect(harness.state.runs[run.id]?.outcome).toBe('cancelled');
    expect(harness.task(taskId).stage).toBe('merged');
    expect(
      harness.send({ type: 'watchdog.stop', taskId, watchdogId: watchdog(harness, taskId).id }).events
    ).toEqual([]);
  });

  test('you mark a watched task done and its watchdogs stop; an agent cannot while one watches', () => {
    const { harness, taskId } = mergeWith([LATENCY, EVENTS]);
    expect(refusal(() => harness.send({ type: 'task.complete', taskId }, { onBehalf: true }))).toEqual({
      code: 'task_open',
      message:
        "2 watchdogs still watch this task's change. Leave it open until they finish, or tell the human.",
    });
    harness.send({ type: 'task.complete', taskId });
    expect(harness.task(taskId).watchdogs?.map((dog) => dog.status)).toEqual(['stopped', 'stopped']);
  });

  test('cancelling a task stops its watchdogs', () => {
    const { harness, taskId } = mergeWith();
    harness.send({ type: 'task.cancel', taskId });
    expect(watchdog(harness, taskId).status).toBe('stopped');
  });
});

describe('a project’s data sources', () => {
  test('you write, widen and remove them', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const { id } = projectOf(harness, taskId);
    const repoId = harness.task(taskId).repoId ?? '';
    harness.send({
      type: 'watch_source.write',
      projectId: id,
      server: 'maple',
      data: 'Logs',
      repoIds: [repoId],
    });
    expect(
      harness.send({
        type: 'watch_source.write',
        projectId: id,
        server: 'maple',
        data: 'Logs',
        repoIds: [repoId],
      }).events
    ).toEqual([]);
    harness.send({
      type: 'watch_source.write',
      projectId: id,
      server: 'maple',
      data: 'Logs and traces',
      repoIds: [],
    });
    expect(projectOf(harness, taskId).watchSources).toEqual([
      expect.objectContaining({ server: 'maple', data: 'Logs and traces', repoIds: [repoId] }),
    ]);
    harness.send({ type: 'project.write', project: { id, name: 'Renamed', color: 'blue' } });
    expect(projectOf(harness, taskId).watchSources).toHaveLength(1);
    harness.send({ type: 'watch_source.remove', projectId: id, server: 'maple' });
    expect(projectOf(harness, taskId).watchSources).toEqual([]);
    expect(harness.send({ type: 'watch_source.remove', projectId: id, server: 'maple' }).events).toEqual([]);
  });

  test('refuses an unknown project or repository, and more than twenty', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const { id } = projectOf(harness, taskId);
    expect(
      refusal(() =>
        harness.send({ type: 'watch_source.write', projectId: 'nope', server: 'a', data: 'b', repoIds: [] })
      ).code
    ).toBe('project_not_found');
    expect(
      refusal(() => harness.send({ type: 'watch_source.remove', projectId: 'nope', server: 'a' })).code
    ).toBe('project_not_found');
    expect(
      refusal(() =>
        harness.send({ type: 'watch_source.write', projectId: id, server: 'a', data: 'b', repoIds: ['r'] })
      ).code
    ).toBe('repo_not_found');
    for (let index = 0; index < 20; index += 1) {
      harness.send({
        type: 'watch_source.write',
        projectId: id,
        server: `s${index}`,
        data: 'd',
        repoIds: [],
      });
    }
    expect(
      refusal(() =>
        harness.send({
          type: 'watch_source.write',
          projectId: id,
          server: 'one-more',
          data: 'd',
          repoIds: [],
        })
      ).code
    ).toBe('too_many_sources');
  });
});

describe('watchdogs in the prompts', () => {
  test('the last phase lists the project’s sources for the repository, and the reviewer the watchdogs', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const { id } = projectOf(harness, taskId);
    harness.send({ type: 'watch_source.write', projectId: id, server: 'maple', data: 'Traces', repoIds: [] });
    handOver(harness, taskId, [LATENCY, EVENTS]);
    const last =
      harness.state.runs[Object.values(harness.state.runs).find((run) => run.phaseIndex === 1)?.id ?? ''];
    expect(readInstruction(last as never)).toContain('- `maple`: Traces');
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const review = readInstruction(harness.activeRun(taskId));
    expect(review).toContain(
      '- Checkout latency: first check after 360 min, gaps up to 6 h, for 48 h, from maple.'
    );
    expect(review).toContain(
      '- Paywall events: first check after 720 min, gaps up to 12 h, for 24 h, needs a source: Product analytics events'
    );
  });

  test('read_task lists each watchdog with its source, state, checks and what it checks', () => {
    const { harness, taskId } = mergeWith([LATENCY, EVENTS]);
    fire(harness, taskId);
    report(harness, taskId, true);
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      [
        'Watchdogs on the merged change:',
        `  1. Checkout latency from maple (watching, 1 check): ${LATENCY.check}`,
        `  2. Paywall events (waits for a data source, 0 checks): ${EVENTS.check}`,
      ].join('\n')
    );
  });

  test('a replayed log rebuilds the same watchdogs', () => {
    const { harness, taskId } = mergeWith([LATENCY, EVENTS]);
    fire(harness, taskId);
    report(harness, taskId, true);
    const replayed = replayEventLog(harness.events);
    expect(replayed.state.tasks[taskId]?.watchdogs).toEqual(harness.task(taskId).watchdogs);
  });
});

describe('watchdogs on your behalf', () => {
  test('an agent stops and connects watchdogs and writes sources, each recorded as done for you', () => {
    const { harness, taskId } = mergeWith([LATENCY, EVENTS]);
    const project = projectOf(harness, taskId);
    const summaries = () =>
      harness.events.filter((event) => event.type === 'on_behalf.acted').map((event) => event.summary);
    harness.send(
      {
        type: 'watchdog.connect',
        taskId,
        watchdogId: watchdog(harness, taskId, 1).id,
        server: 'posthog',
        data: 'Events',
      },
      { onBehalf: true }
    );
    harness.send(
      { type: 'watchdog.stop', taskId, watchdogId: watchdog(harness, taskId).id },
      { onBehalf: true }
    );
    harness.send(
      { type: 'watch_source.write', projectId: project.id, server: 'sentry', data: 'Errors', repoIds: [] },
      { onBehalf: true }
    );
    harness.send(
      { type: 'watch_source.remove', projectId: project.id, server: 'sentry' },
      { onBehalf: true }
    );
    expect(summaries()).toEqual([
      'Connected posthog to a watchdog of “Fix tab group scroll”',
      'Stopped a watchdog of “Fix tab group scroll”',
      'Saved sentry as a data source of Superwall',
      'Removed sentry from the data sources of Superwall',
    ]);
  });
});
