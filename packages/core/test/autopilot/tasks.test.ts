import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  AUTOPILOT_SUGGESTION_SYSTEM,
  AUTOPILOT_SUGGESTION_VERDICTS,
  resolveAutopilotSuggestionLimit,
  selectAutopilotJudgeRequest,
  selectAutopilotSuggestionRequest,
} from '../../src/autopilot/index.ts';
import { AUTOPILOT_DEFAULTS, type AutopilotPolicy } from '../../src/domain/settings.ts';
import type { SuggestedTask, TaskSuggestion } from '../../src/index.ts';
import { listOpenGates } from '../../src/state/queries.ts';
import {
  createHarness,
  createTask,
  type Harness,
  registerRepo,
  resolveReply,
  verifySetup,
} from '../harness.ts';

const PROPOSAL = { request: 'Stream the export in chunks.', why: 'It reads the whole file into memory.' };

function withAutopilot(policy: Partial<AutopilotPolicy> = {}) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, ...policy } } });
  return harness;
}

function investigate(harness: Harness, watchdog: boolean, operation = false) {
  const repoId = Object.keys(harness.state.repos)[0] || registerRepo(harness);
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'task.create', request: 'Why does the export hang on large files?', repoId: null });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  if (watchdog) {
    harness.state.tasks[taskId] = {
      ...harness.task(taskId),
      createdBy: { kind: 'watchdog', taskId: 'shipped', runId: 'run-0', requestKey: 'k' },
    };
  }
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Find why the export hangs',
    repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: [],
    shape: operation ? 'operation' : 'investigate',
    reasons: { shape: 'It asks why.', priority: 'Nothing urgent.', start: 'Independent.' },
  });
  verifySetup(harness, taskId);
  if (harness.task(taskId).stage === 'triage') {
    harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: `fix/${taskId}` });
  }
  const runId = harness.activeRun(taskId).id;
  harness.send({
    type: 'agent.deliver',
    runId,
    step: 'investigate',
    body: 'The investigate result.',
    recommend: 'go_on',
    ...resolveReply(harness, runId),
    proposal: PROPOSAL,
  });
  return taskId;
}

function proposalGate(harness: Harness, taskId: string) {
  return listOpenGates(harness.state, taskId).find((gate) => gate.type === 'proposal');
}

function judgeProposal(harness: Harness, taskId: string, verdict: 'act' | 'forward', reason: string) {
  const gate = proposalGate(harness, taskId);
  if (!gate) throw new Error('No proposal waits.');
  return harness.send({
    type: 'autopilot.judgment',
    taskId,
    gateId: gate.id,
    verdict,
    reason,
    reply: null,
    shadow: false,
  });
}

describe('Autopilot on a watchdog task’s proposal', () => {
  test('gives your OK on a watchdog task’s proposal it judged, and the work goes on to its plan', () => {
    const harness = withAutopilot();
    const taskId = investigate(harness, true);
    expect(proposalGate(harness, taskId)).toMatchObject({ autopilotJudging: true });
    const request = Option.getOrThrow(
      selectAutopilotJudgeRequest(harness.state, proposalGate(harness, taskId)?.id ?? '', 0)
    );
    expect(request.prompt).toContain('Decision: Give your OK on the agent’s proposal');
    expect(request.prompt).toContain('Filed by a watchdog: yes');
    judgeProposal(harness, taskId, 'act', 'A clear, small fix for what the watchdog found.');
    expect(proposalGate(harness, taskId)).toBeUndefined();
    expect(harness.task(taskId).proposal).toMatchObject({ status: 'accepted' });
    expect(
      harness.task(taskId).activity.find((entry) => entry.text.startsWith('Approved for you by Autopilot'))
    ).toMatchObject({ actor: 'shinsa', detail: 'A clear, small fix for what the watchdog found.' });
  });

  test('brings it to you when it judged so', () => {
    const harness = withAutopilot();
    const taskId = investigate(harness, true);
    judgeProposal(harness, taskId, 'forward', 'The fix touches the billing path.');
    expect(proposalGate(harness, taskId)).toMatchObject({
      autopilotJudging: false,
      autopilotHeld: 'The fix touches the billing path.',
    });
    expect(harness.task(taskId).proposal).toMatchObject({ status: 'open' });
  });

  test('leaves a proposal on a task you filed alone, without a word', () => {
    const harness = withAutopilot();
    const taskId = investigate(harness, false);
    expect(proposalGate(harness, taskId)).toMatchObject({ status: 'open' });
    expect(proposalGate(harness, taskId)?.autopilotJudging).toBeUndefined();
    expect(proposalGate(harness, taskId)?.autopilotHeld).toBeUndefined();
  });

  test('with Watchdog tasks off, it brings the proposal to you and says why', () => {
    const harness = withAutopilot({ gates: ['plans', 'questions', 'reviews'] });
    const taskId = investigate(harness, true);
    expect(proposalGate(harness, taskId)).toMatchObject({
      autopilotHeld: 'Autopilot does not act on this kind of gate.',
      autopilotTeaches: false,
    });
  });

  test('a task you asked to see the plan of first stays with you', () => {
    const harness = withAutopilot();
    const taskId = investigate(harness, true);
    const gate = proposalGate(harness, taskId);
    harness.state.tasks[taskId] = { ...harness.task(taskId), planFirst: true };
    judgeProposal(harness, taskId, 'act', 'Clear.');
    expect(proposalGate(harness, taskId)).toMatchObject({
      id: gate?.id,
      autopilotHeld: 'This asks for you: it runs an operation or you asked to see its plan.',
    });
  });

  test('a judgment for a proposal on a task you filed is held back by the limits', () => {
    const harness = withAutopilot();
    const taskId = investigate(harness, false);
    const gate = proposalGate(harness, taskId);
    if (!gate) throw new Error('No proposal waits.');
    harness.state.gates[gate.id] = { ...gate, autopilotJudging: true };
    judgeProposal(harness, taskId, 'act', 'Clear.');
    expect(proposalGate(harness, taskId)).toMatchObject({
      autopilotHeld: 'Autopilot gives your OK only on tasks a watchdog filed.',
    });
  });
});

function suggestion(title: string, extra: Partial<SuggestedTask> = {}): SuggestedTask {
  return {
    title,
    request: `${title}, because the review found it.`,
    why: 'It came up.',
    waitsOnThis: false,
    ...extra,
  };
}

function suggest(harness: Harness, taskId: string, suggestions: SuggestedTask[]) {
  return harness.send({ type: 'agent.suggest_tasks', runId: harness.activeRun(taskId).id, suggestions });
}

function weighed(harness: Harness, taskId: string, verdict: 'accept' | 'dismiss' | 'forward', reason = '') {
  const suggestionId = harness.task(taskId).suggestions?.at(-1)?.id ?? '';
  return harness.send({ type: 'autopilot.weighed', taskId, suggestionId, verdict, reason });
}

function weighEffects(result: ReturnType<Harness['send']>) {
  return result.effects.filter((effect) => effect.kind === 'autopilot.weigh');
}

describe('Autopilot on suggested tasks', () => {
  test('asks a model about each suggestion an agent makes, with Suggested tasks on', () => {
    const harness = withAutopilot({ gates: ['suggestions'] });
    const taskId = createTask(harness);
    const result = suggest(harness, taskId, [
      suggestion('Cache the session'),
      suggestion('Retry the export'),
    ]);
    const ids = harness.task(taskId).suggestions?.map((item) => item.id);
    expect(weighEffects(result)).toEqual(
      (ids ?? []).map((suggestionId) => ({ kind: 'autopilot.weigh', taskId, suggestionId }))
    );
  });

  test('adds a suggestion it is sure about, starting as the agent suggested, and says why', () => {
    const harness = withAutopilot({ gates: ['suggestions'] });
    const taskId = createTask(harness);
    suggest(harness, taskId, [suggestion('Retry the export', { waitsOnThis: true })]);
    weighed(harness, taskId, 'accept', 'A small follow-up you always add.');
    const added = harness.task(taskId).suggestions?.[0];
    expect(added).toMatchObject({ status: 'accepted' });
    const created = harness.task(added?.createdTaskId ?? '');
    expect(created.request).toBe('Retry the export, because the review found it.');
    expect(created.waitsOn).toEqual([taskId]);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      kind: 'suggestion',
      text: 'Added for you by Autopilot: “Retry the export”',
      detail: 'A small follow-up you always add.',
    });
    expect(harness.state.autopilotProfile?.total ?? 0).toBe(0);
  });

  test('dismisses one it is sure is not worth doing, with a reason even when the model gave none', () => {
    const harness = withAutopilot({ gates: ['suggestions'] });
    const taskId = createTask(harness);
    suggest(harness, taskId, [suggestion('Rename everything')]);
    weighed(harness, taskId, 'dismiss', '   ');
    expect(harness.task(taskId).suggestions?.[0]).toMatchObject({ status: 'dismissed', createdTaskId: null });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      text: 'Dismissed for you by Autopilot: “Rename everything”',
      detail: 'Autopilot judged it not worth doing.',
    });
  });

  test('leaves one it is unsure about open for you', () => {
    const harness = withAutopilot({ gates: ['suggestions'] });
    const taskId = createTask(harness);
    suggest(harness, taskId, [suggestion('Cache the session')]);
    expect(weighed(harness, taskId, 'forward', 'Needs your priorities.').events).toEqual([]);
    expect(harness.task(taskId).suggestions?.[0]).toMatchObject({ status: 'open' });
  });

  test('does nothing for a suggestion already settled, or once you turned Suggested tasks off', () => {
    const harness = withAutopilot({ gates: ['suggestions'] });
    const taskId = createTask(harness);
    suggest(harness, taskId, [suggestion('Cache the session')]);
    harness.send({ type: 'settings.change', patch: { autopilot: { ...AUTOPILOT_DEFAULTS, enabled: true } } });
    expect(weighed(harness, taskId, 'accept').events).toEqual([]);
    harness.send({
      type: 'settings.change',
      patch: { autopilot: { enabled: true, gates: ['suggestions'] } },
    });
    const suggestionId = harness.task(taskId).suggestions?.[0]?.id ?? '';
    harness.send({ type: 'suggestion.dismiss', taskId, suggestionId });
    expect(weighed(harness, taskId, 'accept').events).toEqual([]);
    expect(
      harness.send({ type: 'autopilot.weighed', taskId: 'none', suggestionId, verdict: 'accept', reason: '' })
        .events
    ).toEqual([]);
  });

  test('asks nothing with Suggested tasks off, which is the default', () => {
    const harness = withAutopilot();
    const taskId = createTask(harness);
    expect(weighEffects(suggest(harness, taskId, [suggestion('Cache the session')]))).toEqual([]);
  });

  test('the request carries the suggestion and how you usually decide suggested tasks', () => {
    const harness = withAutopilot({ gates: ['suggestions'] });
    const taskId = createTask(harness);
    suggest(harness, taskId, [
      suggestion('Cache the session'),
      suggestion('Retry the export', { waitsOnThis: true }),
    ]);
    const [first, second] = harness.task(taskId).suggestions ?? [];
    harness.send({ type: 'suggestion.dismiss', taskId, suggestionId: first?.id ?? '' });
    const request = Option.getOrThrow(
      selectAutopilotSuggestionRequest(harness.state, taskId, second?.id ?? '')
    );
    expect(request.system).toBe(AUTOPILOT_SUGGESTION_SYSTEM);
    expect(request.verdicts).toEqual(AUTOPILOT_SUGGESTION_VERDICTS);
    expect(request.prompt).toContain('Suggested task: Retry the export');
    expect(request.prompt).toContain('Starts: after this task merges');
    expect(request.prompt).toContain('How the developer decides suggested tasks:');
    expect(request.prompt).toContain('dismissed 1');
    expect(Option.isNone(selectAutopilotSuggestionRequest(harness.state, taskId, first?.id ?? ''))).toBe(
      true
    );
    expect(Option.isNone(selectAutopilotSuggestionRequest(harness.state, 'none', 'x'))).toBe(true);
  });

  test('a first suggestion has no habits to show yet, and starts at once', () => {
    const harness = withAutopilot({ gates: ['suggestions'] });
    const taskId = createTask(harness);
    suggest(harness, taskId, [suggestion('Cache the session')]);
    const id = harness.task(taskId).suggestions?.[0]?.id ?? '';
    const request = Option.getOrThrow(selectAutopilotSuggestionRequest(harness.state, taskId, id));
    expect(request.prompt).toContain('Starts: at once');
    expect(request.prompt).not.toContain('How the developer decides');
  });
});

const OPEN: TaskSuggestion = {
  id: 's1',
  runId: 'r1',
  title: 'Cache the session',
  request: 'Cache it.',
  why: 'Speed.',
  waitsOnThis: false,
  status: 'open',
  createdTaskId: null,
  suggestedAt: 0,
};

describe('the hard limits on suggested tasks', () => {
  const on: AutopilotPolicy = { ...AUTOPILOT_DEFAULTS, enabled: true, gates: ['suggestions'] };

  test.each([
    [{ ...on, enabled: false }, OPEN, 'Autopilot is off.'],
    [{ ...on, gates: [] }, OPEN, 'Autopilot does not act on suggested tasks.'],
    [{ ...on, level: 'ask_first' as const }, OPEN, 'Ask me first leaves suggested tasks to you.'],
    [on, { ...OPEN, splitOff: true }, 'You split it off yourself, so it waits for you.'],
    [
      on,
      { ...OPEN, stacksOnThis: true },
      'It would ship in the same pull request as this task, so it waits for you.',
    ],
  ])('refuses %#', (policy, item, reason) => {
    expect(resolveAutopilotSuggestionLimit(policy, item)).toMatchObject({ allowed: false, reason });
  });

  test('allows an ordinary suggestion with Suggested tasks on', () => {
    expect(resolveAutopilotSuggestionLimit(on, OPEN)).toEqual({ allowed: true });
  });
});
