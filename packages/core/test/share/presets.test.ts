import { describe, expect, test } from 'bun:test';
import {
  CUSTOM_PRESET,
  hasShareGroup,
  resolveSharedTask,
  resolveShareScopes,
  resolveShareScopesPreset,
  SHARE_PRESET_SCOPES,
  SHARE_PRESETS,
  type SharedTask,
  type SharedTaskContext,
  type SharePreset,
  type Task,
  VIEW_SCOPES,
  type ViewScope,
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

function context(shown: SharePreset | readonly ViewScope[]): SharedTaskContext {
  return {
    scopes: typeof shown === 'string' ? SHARE_PRESET_SCOPES[shown] : shown,
    owner: 'mona',
    ownerProfile: { name: 'Mona Lisa', avatarUrl: null },
    machine: 'Studio',
    repository: 'superwall/paywall-next',
  };
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
    expect(SHARE_PRESETS).toEqual(['status', 'standard', 'full']);
    const { status, standard, full } = SHARE_PRESET_SCOPES;
    expect(standard.every((group) => hasShareGroup(full, group))).toBe(true);
    expect(hasShareGroup(full, 'messages')).toBe(true);
    expect(hasShareGroup(standard, 'messages')).toBe(false);
    expect(status.every((group) => hasShareGroup(standard, group))).toBe(true);
    expect(hasShareGroup(standard, 'live')).toBe(true);
    expect(hasShareGroup(status, 'live')).toBe(false);
    expect(hasShareGroup(status, 'requests')).toBe(false);
    expect(hasShareGroup(status, 'code')).toBe(false);
  });

  test('Status keeps the title, the written description, where the task stands and a customer update, and no request, headline, who or where', () => {
    const harness = createHarness();
    const taskId = reachPullRequest(harness);
    const task = harness.task(taskId);
    const status = share(harness, taskId, 'status');
    expect(status).toMatchObject({
      scopes: SHARE_PRESET_SCOPES.status,
      owner: null,
      ownerProfile: null,
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
    expect(status.update).toBe('ready');
    expect(status.task.report).toBeNull();
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
    const status = resolveSharedTask(
      harness.state,
      {
        ...task,
        share: {
          at: 1,
          url: null,
          limit: 'none' as const,
          scopes: SHARE_PRESET_SCOPES.status,
          endsAt: null,
          description: links,
        },
      },
      context('status')
    );
    expect(status.description).toBe('See scroll.ts on feat/acme in  and #7.');
    expect(status.task.summary).toBeNull();
    expect(JSON.stringify(status)).not.toContain('shinsa://');
    expect(JSON.stringify(status)).not.toContain('Acme billing');
    const full = resolveSharedTask(harness.state, task, context('standard'));
    expect(full.task.summary).toBe(links);
    expect(full.task.stageReason).toBe(task.stageReason);
  });

  test('Standard keeps the whole task', () => {
    const harness = createHarness();
    const taskId = reachPullRequest(harness);
    const full = share(harness, taskId, 'standard');
    expect(full).toMatchObject({
      scopes: SHARE_PRESET_SCOPES.standard,
      owner: 'mona',
      ownerProfile: { name: 'Mona Lisa', avatarUrl: null },
      machine: 'Studio',
      code: true,
    });
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
    expect(status.result).toEqual({ step: 'answer', body: '', runId: null, at: 4 });
    expect(status.proposal).toMatchObject({ request: '', why: '', status: 'open', runId: null });
    expect(status.rounds?.[0]?.outcome).toEqual({
      goal: null,
      phases: ['One'],
      headline: null,
      result: null,
    });
    const full = resolveSharedTask(harness.state, task, context('standard')).task;
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
    expect(share(harness, taskId, 'standard').description).toContain('shinsa://file/src/scroll.ts');
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
    expect(kinds('full')).toEqual(['message']);
    expect(kinds('standard')).toEqual([]);
    const shared = resolveSharedTask(harness.state, task, context('full')).task.activity;
    expect(shared[0]?.detail).toBe('Try the left pane.');
  });

  test('the message that started a round keeps its text, never its attachment paths, in every preset', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const task = {
      ...harness.task(taskId),
      activity: [
        {
          at: 1,
          actor: 'you' as const,
          kind: 'round' as const,
          text: 'Started round 2',
          detail:
            'Fix the pane.\n\n<attachments>\n<attachment kind="image" display_name="a.png" path="/Users/me/secret/a.png" url="/api/attachments/01d/a.png" />\n</attachments>',
          evidenceId: null,
        },
      ],
    };
    for (const preset of ['standard', 'full'] as const) {
      const shared = resolveSharedTask(harness.state, task, context(preset)).task.activity;
      expect(shared[0]?.detail).toBe('Fix the pane.');
      expect(JSON.stringify(shared)).not.toContain('/Users/me/secret');
    }
  });
});

const FINDING = {
  severity: 'optional' as const,
  file: 'src/scroll.ts',
  line: 4,
  message: 'Clamp the offset.',
};

const MESSAGE = {
  at: 1,
  actor: 'you' as const,
  kind: 'message' as const,
  text: 'Try the left pane.',
  detail: 'Try the left pane.',
  evidenceId: null,
};

function createWholeTask(harness: Harness): Task {
  const task = harness.task(reachPullRequest(harness));
  return {
    ...task,
    summary: 'Tab groups scroll again.',
    findings: [FINDING],
    share: {
      at: 1,
      url: null,
      limit: 'none',
      scopes: SHARE_PRESET_SCOPES.full,
      endsAt: null,
      description: 'It scrolls.',
    },
  };
}

const SCOPE_PROBES: Readonly<Record<ViewScope, (shared: SharedTask, task: Task) => boolean>> = {
  identity: (shared, task) => shared.task.title === task.title && shared.task.handle === task.handle,
  description: (shared) => shared.description !== null,
  requests: (shared) => shared.task.request !== '',
  progress: (shared) => shared.update !== null && shared.task.phases.length > 0,
  summary: (shared) => shared.task.summary !== null,
  people: (shared) => shared.owner !== null && shared.task.repoId !== null && shared.repo !== null,
  plan: (shared) => Boolean(shared.task.plan?.document?.approach),
  reports: (shared) => shared.task.phaseReports.length > 0,
  review: (shared) => shared.task.findings.length > 0,
  evidence: (shared) => shared.evidence.length > 0,
  checks: (shared) => shared.task.checkResults !== null,
  pull_request: (shared) => shared.task.pullRequest !== null,
  activity: (shared) => shared.task.activity.some((entry) => entry.kind !== 'message'),
  code: (shared) => shared.code,
  runs: (shared) => shared.runs.length > 0,
  live: (shared) => shared.scopes.includes('live'),
  messages: (shared) => shared.task.activity.some((entry) => entry.kind === 'message'),
};

describe('custom share scopes', () => {
  test('each view scope on its own shows its own fields and nothing another scope holds', () => {
    const harness = createHarness();
    const whole = createWholeTask(harness);
    const task = { ...whole, activity: [...whole.activity, MESSAGE] };
    for (const scope of VIEW_SCOPES) {
      const scopes: readonly ViewScope[] = scope === 'messages' ? ['activity', 'messages'] : [scope];
      const shared = resolveSharedTask(harness.state, task, context(scopes));
      const shown = VIEW_SCOPES.filter((probe) => SCOPE_PROBES[probe](shared, task));
      expect({ scope, shown }).toEqual({ scope, shown: [...resolveShareScopes(scopes)] });
    }
  });

  test('the full set shows every scope, and a share always shows the title', () => {
    const harness = createHarness();
    const whole = createWholeTask(harness);
    const task = { ...whole, activity: [...whole.activity, MESSAGE] };
    const every = resolveSharedTask(harness.state, task, context(VIEW_SCOPES));
    expect(VIEW_SCOPES.filter((probe) => SCOPE_PROBES[probe](every, task))).toEqual([...VIEW_SCOPES]);
    const none = resolveSharedTask(harness.state, task, context([]));
    expect(none.scopes).toEqual(['identity']);
    expect(none.task.title).toBe(task.title);
    expect(none.task.request).toBe('');
  });

  test('a scope list is kept in order, once, and named by the preset it matches or Custom', () => {
    expect(resolveShareScopes(['code', 'plan', 'code'])).toEqual(['identity', 'plan', 'code']);
    for (const preset of SHARE_PRESETS) {
      expect(resolveShareScopesPreset([...SHARE_PRESET_SCOPES[preset]].reverse())).toBe(preset);
    }
    expect(resolveShareScopesPreset(SHARE_PRESET_SCOPES.standard.filter((scope) => scope !== 'code'))).toBe(
      CUSTOM_PRESET
    );
    expect(resolveShareScopesPreset(['description', 'progress'])).toBe('status');
  });
});
