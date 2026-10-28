import { describe, expect, test } from 'bun:test';
import {
  type DomainError,
  HOUR_MS,
  listActiveRuns,
  listOpenGates,
  MINUTE_MS,
  replayEventLog,
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
  everyHours: 6,
  forHours: 48,
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
  everyHours: 12,
  forHours: 24,
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

function mergeWith(watchdogs: WatchdogSpec[] = [LATENCY]) {
  const harness = createHarness();
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
  return { harness, taskId };
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

function report(
  harness: Harness,
  taskId: string,
  healthy: boolean,
  issue: { title: string; request: string } | null = null
) {
  return harness.send({
    type: 'agent.report_watch',
    runId: harness.activeRun(taskId).id,
    healthy,
    summary: healthy ? 'p95 is 210 ms, errors 0.2%.' : 'p95 is 1.8 s in Safari since the merge.',
    issue,
  });
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
  test('runs as a read-only turn of the task’s own session and goes back to rest after a healthy report', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    expect(harness.task(taskId).stage).toBe('watching');
    expect(run).toMatchObject({ role: 'agent', purpose: 'watch', sessionId: 'agent-session', resume: true });
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

  test('passes once the next check would fall past its window, and later checks see the earlier ones', () => {
    const { harness, taskId } = mergeWith([{ ...LATENCY, everyHours: 6, forHours: 16 }]);
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
    const { harness, taskId } = mergeWith([{ ...LATENCY, everyHours: 24, forHours: 24 }]);
    expect(watchdog(harness, taskId).nextCheckAt).toBe(watchdog(harness, taskId).endsAt);
    fire(harness, taskId);
    expect(harness.activeRun(taskId).purpose).toBe('watch');
    report(harness, taskId, true);
    expect(watchdog(harness, taskId)).toMatchObject({ status: 'passed', checks: [{ healthy: true }] });
  });

  test('a check deferred past the window’s end passes it without a run', () => {
    const { harness, taskId } = mergeWith([{ ...LATENCY, everyHours: 24, forHours: 24 }]);
    harness.send({ type: 'task.message', taskId, text: 'Add a retry button too.', kind: 'new_round' });
    fire(harness, taskId);
    expect(watchdog(harness, taskId).nextCheckAt).toBe(harness.now + 15 * MINUTE_MS);
    fire(harness, taskId);
    expect(watchdog(harness, taskId)).toMatchObject({ status: 'passed', checks: [] });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('The watchdog “Checkout latency” passed');
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

  test('an issue files a task forked from this one, with the issue as its request', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    report(harness, taskId, false, {
      title: 'Checkout is slow in Safari',
      request: 'Fix the cache miss on Safari that makes checkout take 1.8 s.',
    });
    const tripped = watchdog(harness, taskId);
    expect(tripped.status).toBe('tripped');
    const forked = harness.task(tripped.forkTaskId ?? '');
    expect(forked).toMatchObject({
      forkOf: taskId,
      repoId: harness.task(taskId).repoId,
      createdBy: { kind: 'watchdog', taskId, runId: run.id, requestKey: tripped.id },
    });
    expect(forked.request).toContain('Fix the cache miss on Safari');
    expect(forked.request).toContain('Found by the watchdog “Checkout latency”');
    expect(harness.task(taskId).stage).toBe('merged');
    expect(
      harness.task(taskId).activity.some((entry) => entry.text.includes('found an issue and filed'))
    ).toBe(true);
  });

  test('a report with no watchdog waiting on it is refused', () => {
    const { harness, taskId } = mergeWith();
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    harness.replay({
      type: 'watchdog.ended',
      taskId,
      watchdogId: watchdog(harness, taskId).id,
      status: 'stopped',
      by: 'you',
    });
    expect(
      refusal(() =>
        harness.send({ type: 'agent.report_watch', runId: run.id, healthy: true, summary: 'ok', issue: null })
      ).code
    ).toBe('watchdog_not_found');
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
    const { harness, taskId } = mergeWith([{ ...LATENCY, everyHours: 30, forHours: 48 }]);
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
      status: 'stopped',
      by: 'you',
    });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.task(taskId).stage).toBe('merged');
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
    expect(review).toContain('- Checkout latency: every 6 h for 48 h, from maple.');
    expect(review).toContain(
      '- Paywall events: every 12 h for 24 h, needs a source: Product analytics events'
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
