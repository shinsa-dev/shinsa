import { describe, expect, test } from 'bun:test';
import {
  hasShareGroup,
  resolveSharedTask,
  SHARE_PRESET_GROUPS,
  SHARE_PRESETS,
  type SharedTaskContext,
  type SharePreset,
} from '../../src/index.ts';
import {
  approve,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
  registerRepo,
} from '../harness.ts';

const REQUEST =
  'Fix the scroll in tab groups\n\n<attachments>\n<attachment kind="image" display_name="shot.png" path="/data/attachments/01b/shot.png" url="/api/attachments/01b/shot.png" />\n</attachments>';

function context(preset: SharePreset): SharedTaskContext {
  return { preset, owner: 'mona', machine: 'Studio', repository: 'superwall/paywall-next' };
}

function reachPullRequest(harness: Harness) {
  registerRepo(harness);
  const taskId = createTask(harness, { request: REQUEST });
  proposePlan(harness, taskId);
  harness.send({
    type: 'agent.attach_evidence',
    runId: harness.activeRun(taskId).id,
    kind: 'note',
    title: 'Measured',
    uri: 'https://preview.example.dev',
  });
  completePhase(harness, taskId);
  completePhase(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings: [],
  });
  approve(harness, taskId);
  pushed(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'open' }) });
  return taskId;
}

function share(harness: Harness, taskId: string, preset: SharePreset) {
  return resolveSharedTask(harness.state, harness.task(taskId), context(preset));
}

describe('share presets', () => {
  test('each preset is a list of field groups, and Default holds every group Status has and the live output', () => {
    expect(SHARE_PRESETS).toEqual(['default', 'status', 'everything']);
    expect(SHARE_PRESET_GROUPS.default.every((group) => hasShareGroup('everything', group))).toBe(true);
    expect(hasShareGroup('everything', 'messages')).toBe(true);
    expect(hasShareGroup('default', 'messages')).toBe(false);
    expect(SHARE_PRESET_GROUPS.status.every((group) => hasShareGroup('default', group))).toBe(true);
    expect(hasShareGroup('default', 'live')).toBe(true);
    expect(hasShareGroup('status', 'live')).toBe(false);
    expect(hasShareGroup('status', 'requests')).toBe(false);
    expect(hasShareGroup('status', 'code')).toBe(false);
  });

  test('Status keeps the title, the written description, where the task stands and its headline, and no request, who or where', () => {
    const harness = createHarness();
    const taskId = reachPullRequest(harness);
    const task = harness.task(taskId);
    const status = share(harness, taskId, 'status');
    expect(status).toMatchObject({
      preset: 'status',
      owner: null,
      machine: null,
      repository: null,
      repo: null,
      project: null,
      code: false,
      gates: [],
      runs: [],
      evidence: [],
    });
    expect(status.task).toMatchObject({
      id: task.id,
      handle: task.handle,
      title: task.title,
      request: '',
      stage: task.stage,
      stageReason: '',
      phases: task.phases,
      projectId: null,
      repoId: null,
      branch: null,
      pullRequest: null,
      pushedSha: null,
      findings: [],
      reviewSummary: null,
      phaseReports: [],
      checks: [],
      checkResults: null,
      activity: [],
      mergeStepsDone: [],
      watchdogs: [],
      triageDecisions: null,
    });
    expect(status.task.report).toEqual({
      headline: task.report?.headline ?? '',
      sections: [],
      checks: [],
      judgementCalls: [],
      walkthrough: null,
    });
    expect(status.task.plan?.body).toBe('');
    expect(status.task.plan?.document).toEqual({
      goal: '',
      phases: (task.plan?.document?.phases ?? []).map((phase) => ({ title: phase.title, detail: '' })),
      behaviour: [],
      approach: '',
      files: [],
      outOfScope: [],
      verification: [],
      questions: [],
    });
    expect(status.task.rounds?.[0]).toMatchObject({
      title: task.title,
      request: '',
      branch: null,
      base: null,
      pullRequest: null,
    });
  });

  test('Status sends no link to a file, branch, repository or pull request, and no stage reason naming other work', () => {
    const harness = createHarness();
    const taskId = reachPullRequest(harness);
    const links =
      'See [scroll.ts](shinsa://file/src/scroll.ts#L4) on [feat/acme](shinsa://branch/feat/acme) in shinsa://repo/acme-internal and [#7](shinsa://pr/acme-internal#7).';
    const task = {
      ...harness.task(taskId),
      summary: links,
      stageReason: 'waiting for “Acme billing” to finish',
    };
    const status = resolveSharedTask(harness.state, task, context('status'));
    expect(status.task.summary).toBe('See scroll.ts on feat/acme in  and #7.');
    expect(JSON.stringify(status)).not.toContain('shinsa://');
    expect(JSON.stringify(status)).not.toContain('Acme billing');
    const full = resolveSharedTask(harness.state, task, context('default'));
    expect(full.task.summary).toBe(links);
    expect(full.task.stageReason).toBe(task.stageReason);
  });

  test('Default keeps the whole task', () => {
    const harness = createHarness();
    const taskId = reachPullRequest(harness);
    const full = share(harness, taskId, 'default');
    expect(full).toMatchObject({ preset: 'default', owner: 'mona', machine: 'Studio', code: true });
    expect(full.task.pullRequest?.state).toBe('open');
    expect(full.task.plan?.document?.approach).toBe(harness.task(taskId).plan?.document?.approach);
    expect(full.evidence).toHaveLength(1);
    expect(full.runs.length).toBeGreaterThan(0);
  });

  test('a task with no plan, report, result or proposal shares none of them under any preset', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    for (const preset of SHARE_PRESETS) {
      expect(share(harness, taskId, preset).task).toMatchObject({
        plan: null,
        report: null,
        result: null,
        proposal: null,
      });
    }
  });

  test('a result and a proposal keep only their step and status under Status', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const task = {
      ...harness.task(taskId),
      result: { step: 'answer' as const, body: 'It scrolls now.', runId: 'r1', at: 4 },
      proposal: { request: 'Change it.', why: 'Because.', status: 'open' as const, runId: 'r1', at: 4 },
      rounds: [
        {
          ...harness.task(taskId).rounds?.[0],
          outcome: { goal: 'Ship it.', phases: ['One'], headline: 'Done.', result: 'Answered.' },
        },
      ] as never,
    };
    const status = resolveSharedTask(harness.state, task, context('status')).task;
    expect(status.result).toEqual({ step: 'answer', body: 'It scrolls now.', runId: null, at: 4 });
    expect(status.proposal).toMatchObject({ request: '', why: '', status: 'open', runId: null });
    expect(status.rounds?.[0]?.outcome).toEqual({
      goal: null,
      phases: ['One'],
      headline: 'Done.',
      result: 'Answered.',
    });
    const full = resolveSharedTask(harness.state, task, context('default')).task;
    expect(full.proposal).toMatchObject({ request: 'Change it.', why: 'Because.' });
    expect(full.rounds?.[0]?.outcome?.goal).toBe('Ship it.');
  });

  test('the written description goes to every preset, without links Status may not carry', () => {
    const harness = createHarness();
    const taskId = reachPullRequest(harness);
    harness.send({ type: 'task.share', taskId });
    expect(share(harness, taskId, 'status').description).toBeNull();
    harness.send({
      type: 'share.describe',
      taskId,
      description: 'Tab groups did not scroll on [scroll.ts](shinsa://file/src/scroll.ts).',
    });
    expect(share(harness, taskId, 'status').description).toBe('Tab groups did not scroll on scroll.ts.');
    expect(share(harness, taskId, 'default').description).toContain('shinsa://file/src/scroll.ts');
  });

  test('only Everything keeps your messages in the activity; questions and answers stay private', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const task = {
      ...harness.task(taskId),
      activity: [
        {
          at: 1,
          actor: 'you' as const,
          kind: 'message' as const,
          text: 'Try the left pane.',
          detail:
            'Try the left pane.\n\n<attachments>\n<attachment kind="file" display_name="n.txt" path="/Users/me/.config/shinsa/data/attachments/01c/n.txt" url="/api/attachments/01c/n.txt" />\n</attachments>',
          evidenceId: null,
        },
        {
          at: 2,
          actor: 'you' as const,
          kind: 'answer' as const,
          text: 'Use the token.',
          detail: null,
          evidenceId: null,
        },
      ],
    };
    const kinds = (preset: SharePreset) =>
      resolveSharedTask(harness.state, task, context(preset)).task.activity.map((entry) => entry.kind);
    expect(kinds('everything')).toEqual(['message']);
    expect(kinds('default')).toEqual([]);
    const shared = resolveSharedTask(harness.state, task, context('everything')).task.activity;
    expect(shared[0]?.detail).toBe('Try the left pane.');
  });
});
