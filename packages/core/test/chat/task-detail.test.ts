import { describe, expect, test } from 'bun:test';
import { serializeTaskDetail } from '../../src/index.ts';
import {
  approve,
  buildAll,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  proposePlan,
  pullRequest,
  reachReviewGate,
  reachShipping,
  registerRepo,
  shipAndMerge,
  verifySetup,
} from '../harness.ts';

function createAskTask(harness: Harness, answer: string) {
  const repoId = registerRepo(harness);
  harness.send({ type: 'task.create', request: 'How does the login work?', repoId, mode: 'ask' });
  const taskId = Object.keys(harness.state.tasks).at(-1) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'How login works',
    repoId,
    size: 'small',
    branch: 'q',
    waitsOn: [],
  });
  harness.send({ type: 'config.record', taskId, problems: [] });
  harness.send({ type: 'agent.deliver', runId: harness.activeRun(taskId).id, step: 'answer', body: answer });
  return taskId;
}

describe('a task described for an agent', () => {
  test('says whether the task is shared by link, and why its link is missing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(serializeTaskDetail(harness.state, taskId)).not.toContain('Shared by link');
    harness.send({ type: 'task.share', taskId });
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      'Shared by link, waiting for app.shinsa.dev to make the link'
    );
    harness.send({ type: 'share.record', taskId, url: 'https://app.shinsa.dev/share/t/abc' });
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      'Shared by link: https://app.shinsa.dev/share/t/abc'
    );
    harness.send({ type: 'share.fail', taskId, detail: 'Turn on remote access.' });
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      'Shared by link, but it could not be published: Turn on remote access.'
    );
  });

  test('says when there is no such task', () => {
    expect(serializeTaskDetail(createHarness().state, 'nope')).toBe(
      'No task nope. `find_tasks` lists the tasks.'
    );
  });

  test('a task without a repository or plan names its stage, request and that nothing waits on you', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'Tidy the docs', repoId: null });
    const task = Object.values(harness.state.tasks)[0];
    const detail = serializeTaskDetail(harness.state, task?.id ?? '');
    expect(detail.split('\n')).toEqual([
      `[${task?.title}](shinsa://task/${task?.id}) · starting (${task?.stageReason})`,
      `id ${task?.id} · priority normal`,
      'Request: Tidy the docs',
      'No open decisions.',
      'Recent activity:',
      ...(task?.activity ?? []).map(
        (entry) => `- ${new Date(entry.at).toISOString()} the human: ${entry.text}`
      ),
    ]);
  });

  test('names the changed-line coverage once it is measured', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: PASSING,
      coverage: { status: 'measured', command: 'go test', covered: 1, executable: 2, files: [] },
    });
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      'Changed-line coverage: 50% of changed lines are covered (1 of 2).'
    );
  });

  test('lists the plan with each phase, and says once it is approved', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { planFirst: true });
    proposePlan(harness, taskId);
    const proposed = serializeTaskDetail(harness.state, taskId);
    expect(proposed).toContain('· plan to approve');
    expect(proposed).toContain('Plan (version 1): Ship it.');
    expect(proposed).toContain('  1. Find the overflow (pending)');
    approve(harness, taskId);
    completePhase(harness, taskId);
    const building = serializeTaskDetail(harness.state, taskId);
    expect(building).toContain('Plan (version 1, approved): Ship it.');
    expect(building).toContain('  1. Find the overflow (done)');
    expect(building).toContain('  2. Fix and verify (');
  });

  test('lists the checks with where each stands, then the pull request’s CI', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      'The checks Shinsa ran on the change, and where each stands:\n- c1, Panel tests: `bun test src/panel` (not run yet)'
    );
    const shipped = createTask(harness);
    reachShipping(harness, shipped);
    harness.send({
      type: 'pull_request.record',
      taskId: shipped,
      pullRequest: pullRequest({
        checkRuns: [{ name: 'ci / test', status: 'action_required', required: true, url: null }],
      }),
    });
    const detail = serializeTaskDetail(harness.state, shipped);
    expect(detail).toContain('- r2, bun check-types: `bun check-types` (passed)');
    expect(detail).toContain('CI on the pull request:\n- ci / test (action required)');
  });

  test('names the repository, branch and pull request, and what the task waits on', () => {
    const harness = createHarness();
    const blocker = createTask(harness, { request: 'First' });
    const taskId = createTask(harness, { request: 'Second', triageWaitsOn: blocker });
    const queued = serializeTaskDetail(harness.state, taskId);
    expect(queued).toContain(`Waits on: [First](shinsa://task/${blocker})`);
    const shipped = createTask(harness, { request: 'Third' });
    reachShipping(harness, shipped);
    harness.send({ type: 'pull_request.record', taskId: shipped, pullRequest: pullRequest() });
    expect(serializeTaskDetail(harness.state, shipped)).toContain(
      `repository paywall-next · branch fix/${shipped} · pull request #42 open, checks passing`
    );
  });

  test('an Ask task says it answers a question and gives the answer, cut when long', () => {
    const harness = createHarness();
    const taskId = createAskTask(harness, 'a'.repeat(2_000));
    const detail = serializeTaskDetail(harness.state, taskId);
    expect(detail).toContain('· answers a question');
    expect(detail).toContain(`Result (answer): ${'a'.repeat(1_500)}…`);
  });

  test('cuts a long request and a long decision, and lists a decision’s choices', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: `Fix it ${'x'.repeat(2_000)}` });
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'question-1',
      question: 'Which store?',
      context: 'y'.repeat(600),
      choices: ['Redis', 'Postgres'],
    });
    const gate = harness.openGate(taskId);
    const detail = serializeTaskDetail(harness.state, taskId);
    expect(detail).toContain(`Request: Fix it ${'x'.repeat(1_493)}…`);
    expect(detail).toContain('Open decisions:');
    expect(detail).toContain(`- ${gate.title} (gate question-1, ${gate.type}): `);
    expect(detail).toContain('… Choices: Redis | Postgres.');
  });

  test('shows the handle and the project in the header', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const [, second, third] = serializeTaskDetail(harness.state, taskId).split('\n');
    expect(second).toBe(`SUP-1 · id ${taskId} · priority normal`);
    expect(third).toStartWith('project Superwall · repository paywall-next · ');
  });

  test('names the task whose agent acted on the human’s behalf by its handle', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const agentTask = createTask(harness, { request: 'Tidy the backlog' });
    harness.send(
      { type: 'task.message', taskId, text: 'Check the tab bar.' },
      { onBehalf: true, byTask: agentTask }
    );
    harness.send(
      { type: 'task.message', taskId, text: 'And the footer.' },
      { onBehalf: true, byTask: 'gone' }
    );
    const detail = serializeTaskDetail(harness.state, taskId);
    expect(detail).toContain(' the agent of SUP-2 for the human: ');
    expect(detail).toContain(' Shinsa for the human: ');
  });

  test('names the task whose agent acted by its title while it has no handle', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.create', request: 'Untriaged helper', repoId: null, projectId: null });
    const helper = Object.values(harness.state.tasks).find((task) => task.request === 'Untriaged helper');
    harness.send(
      { type: 'task.message', taskId, text: 'Look.' },
      { onBehalf: true, byTask: helper?.id ?? '' }
    );
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      ` the agent of "${helper?.title}" for the human: `
    );
  });

  test('says which activity Shinsa did on the human’s behalf, and shows only the latest ten entries', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    for (let index = 0; index < 12; index += 1) {
      harness.send({ type: 'task.message', taskId, text: `Note ${index}` });
    }
    harness.send({ type: 'task.message', taskId, text: 'From another task.' }, { onBehalf: true });
    const lines = serializeTaskDetail(harness.state, taskId).split('\n');
    const activity = lines.slice(lines.indexOf('Recent activity:') + 1);
    expect(activity).toHaveLength(10);
    expect(activity.some((line) => line.includes(' Shinsa for the human: '))).toBe(true);
    expect(activity.some((line) => line.includes(' the human: '))).toBe(true);
  });

  test('gives the summary of the work once it is reported', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const summary = harness.task(taskId).summary;
    expect(summary).toBeTruthy();
    expect(serializeTaskDetail(harness.state, taskId)).toContain(`Summary: ${summary}`);
  });

  test('gives a later round its own request and number', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Add the export' });
    shipAndMerge(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Add a CSV option', kind: 'new_round', title: 'CSV' });
    const detail = serializeTaskDetail(harness.state, taskId);
    expect(detail).toContain('Request (round 2): Add a CSV option');
    expect(detail).not.toContain('Request: Add the export');
  });

  test('gives the result an inquiry delivered', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'task.create', request: 'Why does it hang?', repoId });
    const taskId = Object.keys(harness.state.tasks).at(-1) ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Why it hangs',
      repoId,
      size: 'small',
      branch: `fix/${taskId}`,
      waitsOn: [],
      shape: 'investigate',
    });
    verifySetup(harness, taskId);
    harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: `fix/${taskId}` });
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'investigate',
      body: 'The loop never yields.',
    });
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      'Result (investigate): The loop never yields.'
    );
  });
});

describe('a task described for an agent, with a guide for testing it', () => {
  test('lists what the tests cover and the steps to try', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    harness.send({
      type: 'agent.complete_phase',
      runId: harness.activeRun(taskId).id,
      summary: 'Done.',
      spots: [],
      judgementCalls: [],
      walkthrough: {
        approach: 'Copy it.',
        flow: 'copy → save',
        risks: [],
        testing: {
          automated: ['duplicate.test.ts covers both kinds.'],
          manual: [
            {
              action: 'Open the paywalls.',
              target: { kind: 'url', value: 'http://localhost:5173/paywalls' },
              expect: 'The list loads.',
            },
          ],
        },
      },
    });
    expect(serializeTaskDetail(harness.state, taskId)).toContain(
      [
        'How to test the change:',
        '  Covered by tests:',
        '  - duplicate.test.ts covers both kinds.',
        '  Try it yourself:',
        '  1. Open the paywalls. [url: http://localhost:5173/paywalls] Expected: The list loads.',
      ].join('\n')
    );
  });
});
