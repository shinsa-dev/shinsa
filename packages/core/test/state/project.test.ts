import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createSettings,
  createState,
  decide,
  replayEventLog,
  resolveFallbackBriefing,
  type ShinsaEvent,
  type ShinsaEventInput,
} from '../../src/index.ts';
import { NOW, queueOf, ready } from '../briefing/fixtures.ts';
import {
  buildAll,
  createHarness,
  createTask,
  pullRequest,
  reachReviewGate,
  reachShipping,
} from '../harness.ts';

describe('briefing events', () => {
  test('store the structured guide per project, and replay older text-only events written for an area', () => {
    const guide = resolveFallbackBriefing(queueOf(ready), NOW);
    const withGuide = applyEvent(createState(), {
      type: 'briefing.written',
      projectId: null,
      text: 'Start with the chat.',
      briefing: guide,
      seq: 1,
      at: NOW,
    });
    expect(withGuide.briefings['*']).toEqual({ text: 'Start with the chat.', at: NOW, briefing: guide });
    const legacy = applyEvent(createState(), {
      type: 'briefing.written',
      areaId: 'area-1',
      text: 'Start with the chat.',
      seq: 1,
      at: NOW,
    });
    expect(legacy.briefings['area-1']).toEqual({ text: 'Start with the chat.', at: NOW, briefing: null });
  });
});

describe('settings events', () => {
  test('replay a settings event from an old log that carries retired settings, and drop them', () => {
    const settings = {
      ...createSettings(),
      mergeMethod: 'rebase' as const,
      worktreesDirectory: '~/wt',
      maxConcurrentRuns: 1,
      holdNewWorkAt: 80,
      retiredSetting: true,
    };
    const state = applyEvent(createState(), { type: 'settings.changed', settings, seq: 1, at: NOW });
    expect(state.settings).toEqual({ ...createSettings(), mergeMethod: 'rebase' });
  });

  test('an older log keeps idle compaction on only where you turned it back on, and gains the new defaults', () => {
    const { compaction: _compaction, fastMode: _fastMode, ...older } = createSettings();
    const written = (
      idleCompaction: boolean,
      seq: number
    ): ShinsaEventInput & { seq: number; at: number } => ({
      type: 'settings.changed',
      settings: { ...older, idleCompaction },
      seq,
      at: NOW,
    });
    const untouched = applyEvent(createState(), written(true, 1));
    expect(untouched.settings).toEqual({ ...createSettings(), idleCompaction: undefined });
    expect('idleCompaction' in untouched.settings).toBe(false);
    const turnedOff = applyEvent(untouched, written(false, 2));
    expect(turnedOff.settings.idleCompaction).toBe(false);
    const turnedOn = applyEvent(turnedOff, written(true, 3));
    expect(turnedOn.settings).toMatchObject({
      idleCompaction: true,
      compaction: 'eunoe_compact',
      fastMode: false,
    });
    expect(applyEvent(turnedOn, written(true, 4)).settings.idleCompaction).toBe(true);
  });

  test('a settings event that knows about compaction is taken as written', () => {
    const settings = {
      ...createSettings(),
      compaction: 'claude' as const,
      idleCompaction: true,
      fastMode: false,
    };
    const state = applyEvent(createState(), { type: 'settings.changed', settings, seq: 1, at: NOW });
    expect(state.settings).toEqual(settings);
  });
});

describe('task activity', () => {
  test('records a stage when the stage changes, not every time its reason does', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    const texts = harness
      .task(taskId)
      .activity.filter((entry) => entry.kind === 'stage')
      .map((entry) => entry.text);
    expect(texts.filter((text) => text === 'Building started')).toHaveLength(1);
    expect(texts.filter((text) => text === 'Opening the pull request')).toHaveLength(1);
  });

  test('says how the checks went, in words that fit the count', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [{ name: 'lint', outcome: 'pass', detail: null }],
    });
    const checks = harness
      .task(taskId)
      .activity.filter((entry) => entry.actor === 'shinsa' && entry.kind === 'review');
    expect(checks.map((entry) => entry.text)).toEqual(['The check passed']);
  });

  test('keeps the last 200 entries', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    for (let index = 0; index < 210; index += 1)
      harness.send({ type: 'agent.note', runId, note: `Note ${index}` });
    const activity = harness.task(taskId).activity;
    expect(activity).toHaveLength(200);
    expect(activity.at(-1)?.text).toBe('Note 209');
  });

  test('events about things that do not exist change nothing', () => {
    const state = createState();
    const at = 0;
    const events: ShinsaEventInput[] = [
      { type: 'task.staged', taskId: 'x', stage: 'planning', reason: 'r' },
      { type: 'task.messaged', taskId: 'x', text: 'hi' },
      { type: 'phase.updated', taskId: 'x', index: 0, status: 'done' },
      {
        type: 'phase.completed',
        taskId: 'x',
        report: { index: 0, summary: '', spots: [], judgementCalls: [], at },
      },
      { type: 'gate.answered', gateId: 'x', decision: 'approve', response: null },
      { type: 'run.linked', runId: 'x', sessionId: 's' },
    ];
    for (const event of events) {
      applyEvent(state, { ...event, seq: state.seq + 1, at });
    }
    expect(state).toEqual({ ...createState(), seq: 6 });
  });
});

describe('replayEventLog', () => {
  test('applies every event it can, reports the ones it cannot, and keeps the highest sequence', () => {
    const events = [
      { type: 'focus.changed', focus: { projectId: null, until: 5 }, seq: 1, at: 1 },
      { type: 'task.created', seq: 2, at: 2 },
      { type: 'focus.changed', focus: { projectId: null, until: 9 }, seq: 3, at: 3 },
      { type: 'task.created', seq: 4, at: 4 },
    ] as unknown as ShinsaEvent[];
    const { state, failures } = replayEventLog(events);
    expect(state.focus.until).toBe(9);
    expect(state.seq).toBe(4);
    expect(failures.map((failure) => [failure.seq, failure.type])).toEqual([
      [2, 'task.created'],
      [4, 'task.created'],
    ]);
    expect(failures[0]?.error).toContain('undefined');
  });
});

function apply(events: ShinsaEventInput[]) {
  let state = createState();
  events.forEach((event, index) => {
    state = applyEvent(state, { ...event, seq: index + 1, at: index + 1 } as ShinsaEvent);
  });
  return state;
}

describe('applying the process events', () => {
  test('events about a task, run, gate or monitor that is not there change nothing', () => {
    const state = apply([
      {
        type: 'run.metered',
        runId: 'r',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 1 },
      },
      { type: 'run.silenced', runId: 'r', since: 1 },
      { type: 'monitor.fired', taskId: 't', monitorId: 'm', attempt: 1 },
      { type: 'monitor.ended', taskId: 't', monitorId: 'm', status: 'cleared' },
      { type: 'suggestion.settled', taskId: 't', suggestionId: 's', status: 'accepted', createdTaskId: null },
      { type: 'plan.approved', taskId: 't', version: 1 },
      { type: 'gate.superseded', gateId: 'g', text: 'x' },
    ]);
    expect(state.tasks).toEqual({});
    expect(state.runs).toEqual({});
    expect(state.gates).toEqual({});
  });

  test('approving an older version leaves the current plan unapproved', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.propose_plan',
      runId: harness.activeRun(taskId).id,
      document: {
        goal: 'G',
        phases: [
          { title: 'A', detail: 'a' },
          { title: 'B', detail: 'b' },
        ],
        behaviour: [],
        approach: 'x',
        files: [],
        outOfScope: [],
        verification: ['Check it by hand.'],
        questions: [],
      },
    });
    const state = applyEvent(structuredClone(harness.state), {
      type: 'plan.approved',
      taskId,
      version: 9,
      seq: harness.state.seq + 1,
      at: 1,
    });
    expect(state.tasks[taskId]?.plan?.approvedAt).toBeUndefined();
  });

  test('dismissing a finding again keeps one copy of it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const findings = [{ severity: 'suggestion' as const, file: 'a.ts', line: 1, message: 'Rename.' }];
    const base = structuredClone(harness.state);
    const task = base.tasks[taskId];
    if (!task) throw new Error('no task');
    base.tasks[taskId] = {
      ...task,
      findings,
      dismissedFindings: [{ ...findings[0], verdict: 'dismiss' } as never],
    };
    const gateId = harness.openGate(taskId).id;
    const state = applyEvent(base, {
      type: 'gate.answered',
      gateId,
      decision: 'approve',
      response: null,
      verdicts: [{ index: 0, verdict: 'dismiss', note: null }],
      seq: base.seq + 1,
      at: 1,
    });
    expect(state.tasks[taskId]?.dismissedFindings).toHaveLength(1);
  });

  test('verdicts for a gate whose task is gone are kept on the gate only', () => {
    const state = apply([
      {
        type: 'gate.opened',
        gate: {
          id: 'g',
          taskId: 'gone',
          kind: 'review',
          purpose: 'decision',
          status: 'open',
          title: 'x',
          body: '',
          runId: null,
          openedAt: 0,
          answeredAt: null,
          decision: null,
          response: null,
        },
      },
      {
        type: 'gate.answered',
        gateId: 'g',
        decision: 'approve',
        response: null,
        verdicts: [{ index: 0, verdict: 'dismiss', note: null }],
      },
    ]);
    expect(state.gates.g?.verdicts).toHaveLength(1);
  });

  test('a fix round from before fingerprints keeps the old shape', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const state = applyEvent(structuredClone(harness.state), {
      type: 'fix.started',
      taskId,
      round: 1,
      reason: 'checks',
      signature: 'lint',
      seq: harness.state.seq + 1,
      at: 1,
    });
    expect(state.tasks[taskId]?.fixFingerprints).toBeUndefined();
    expect(state.tasks[taskId]?.fixHistory).toEqual(['checks:lint']);
  });
});

describe('repositories from an older log', () => {
  test('a repository registered with a preview command replays without it', () => {
    const repo = {
      id: 'r1',
      name: 'app',
      path: '/code/app',
      defaultBranch: 'main',
      remote: null,
      projectId: null,
      checkCommands: [],
      previewCommand: 'bun dev',
    };
    const state = applyEvent(createState(), { type: 'repo.registered', repo, seq: 1, at: NOW });
    expect(state.repos.r1).toEqual({
      id: 'r1',
      name: 'app',
      path: '/code/app',
      defaultBranch: 'main',
      remote: null,
      projectId: null,
      checkCommands: [],
    });
  });
});

describe('logs written before projects', () => {
  const repo = (id: string, areaId: string | null) => ({
    id,
    name: id,
    path: `/code/${id}`,
    defaultBranch: 'main',
    remote: null,
    checkCommands: [],
    areaId,
  });

  function oldTask(taskId: string, repoId: string): ShinsaEventInput[] {
    return [
      { type: 'task.created', taskId, request: `Do ${taskId}`, repoId: null, priority: 'normal' },
      { type: 'task.triaged', taskId, title: `Do ${taskId}`, repoId, size: 'small', branch: `fix/${taskId}` },
    ] as ShinsaEventInput[];
  }

  test('an area becomes a project with a key from its name, no description or folders, and the same id', () => {
    const state = apply([
      { type: 'area.written', area: { id: 'area-1', name: 'Superwall', color: 'purple' } },
      { type: 'area.written', area: { id: 'area-2', name: 'Superbase', color: 'green' } },
    ] as ShinsaEventInput[]);
    expect(state.projects).toEqual({
      'area-1': {
        id: 'area-1',
        name: 'Superwall',
        color: 'purple',
        key: 'SUP',
        description: '',
        folders: [],
      },
      'area-2': { id: 'area-2', name: 'Superbase', color: 'green', key: 'SU', description: '', folders: [] },
    });
  });

  test('writing an area again keeps the key it was given, even after a rename', () => {
    const state = apply([
      { type: 'area.written', area: { id: 'area-1', name: 'Superwall', color: 'purple' } },
      { type: 'area.written', area: { id: 'area-1', name: 'Basket', color: 'blue' } },
    ] as ShinsaEventInput[]);
    expect(state.projects['area-1']).toMatchObject({ name: 'Basket', color: 'blue', key: 'SUP' });
  });

  test('removing an area removes the project', () => {
    const state = apply([
      { type: 'area.written', area: { id: 'area-1', name: 'Superwall', color: 'purple' } },
      { type: 'area.removed', areaId: 'area-1' },
    ] as ShinsaEventInput[]);
    expect(state.projects).toEqual({});
  });

  test('a repository filed in an area is in that project, and no area id is kept', () => {
    const state = apply([
      { type: 'area.written', area: { id: 'area-1', name: 'Superwall', color: 'purple' } },
      { type: 'repo.registered', repo: repo('app', 'area-1') },
      { type: 'repo.registered', repo: repo('notes', null) },
      { type: 'repo.updated', repo: { ...repo('notes', 'area-1'), name: 'notebook' } },
    ] as ShinsaEventInput[]);
    expect(state.repos.app?.projectId).toBe('area-1');
    expect(state.repos.notes).toMatchObject({ name: 'notebook', projectId: 'area-1' });
    expect(Object.values(state.repos).some((entry) => 'areaId' in entry)).toBe(false);
  });

  test('a focus on an area is a focus on its project', () => {
    const state = apply([
      { type: 'area.written', area: { id: 'area-1', name: 'Superwall', color: 'purple' } },
      { type: 'focus.changed', focus: { areaId: 'area-1', until: 9_000 } },
    ] as ShinsaEventInput[]);
    expect(state.focus).toEqual({ projectId: 'area-1', until: 9_000 });
  });

  test('tasks get handles at their triage, in log order, from their repository’s project', () => {
    const events = [
      { type: 'area.written', area: { id: 'area-1', name: 'Superwall', color: 'purple' } },
      { type: 'repo.registered', repo: repo('app', 'area-1') },
      { type: 'repo.registered', repo: repo('scratch', null) },
      ...oldTask('b', 'app'),
      ...oldTask('a', 'app'),
      ...oldTask('c', 'scratch'),
    ] as ShinsaEventInput[];
    const state = apply(events);
    expect(Object.values(state.tasks).map((task) => [task.id, task.handle, task.projectId])).toEqual([
      ['b', 'SUP-1', 'area-1'],
      ['a', 'SUP-2', 'area-1'],
      ['c', 'T-1', null],
    ]);
    expect(state.taskNumbers).toEqual({ SUP: 2, T: 1 });
    expect(apply(events)).toEqual(state);
  });

  test('a task an older log never triaged has no handle, and the next new task continues the count', () => {
    const stateBefore = apply([
      { type: 'area.written', area: { id: 'area-1', name: 'Superwall', color: 'purple' } },
      { type: 'repo.registered', repo: repo('app', 'area-1') },
      ...oldTask('a', 'app'),
      { type: 'task.created', taskId: 'b', request: 'Do b', repoId: null, priority: 'normal' },
    ] as ShinsaEventInput[]);
    expect(stateBefore.tasks.b?.handle).toBeNull();
    const next = decide(
      stateBefore,
      { type: 'task.create', request: 'New', repoId: 'app' },
      {
        now: 100,
        newId: () => 'new',
      }
    );
    expect(next.events[0]).toMatchObject({ type: 'task.created', handle: 'SUP-2', projectId: 'area-1' });
  });
});
