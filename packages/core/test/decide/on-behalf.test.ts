import { describe, expect, test } from 'bun:test';
import type { EventOf } from '../../src/events/index.ts';
import {
  HUMAN_ONLY_REPO_FIELDS,
  HUMAN_ONLY_SETTINGS,
  type Repo,
  type Settings,
  type ShinsaCommand,
} from '../../src/index.ts';
import {
  buildAll,
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  reachReviewGate,
  registerRepo,
} from '../harness.ts';

function actOnBehalf(harness: Harness, command: ShinsaCommand) {
  return harness.send(command, { onBehalf: true });
}

function lastAction(harness: Harness) {
  const event = harness.events.at(-1);
  if (event?.type !== 'on_behalf.acted') throw new Error(`last event is ${event?.type}`);
  return event as EventOf<'on_behalf.acted'>;
}

function suggestFollowUp(harness: Harness, taskId: string, title: string) {
  harness.send({
    type: 'agent.suggest_tasks',
    runId: harness.activeRun(taskId).id,
    suggestions: [{ title, request: `${title} next.`, why: 'It came up.', waitsOnThis: false }],
  });
  const found = harness.task(taskId).suggestions?.find((entry) => entry.title === title);
  if (!found) throw new Error('no suggestion');
  return found.id;
}

function writeSchedule(harness: Harness, scheduleId: string | null, name: string | null) {
  actOnBehalf(harness, {
    type: 'schedule.write',
    scheduleId,
    name,
    text: 'Audit the dependencies.',
    trigger: { kind: 'interval', everyMinutes: scheduleId ? 90 : 60 },
    target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
    enabled: null,
    maxRuns: null,
    timeZone: 'UTC',
  });
}

describe('acting for the human', () => {
  test('stamps every event as done on their behalf and records one summary of the command', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const decision = actOnBehalf(harness, { type: 'task.prioritize', taskId, priority: 'high' });
    expect(decision.events.length).toBeGreaterThan(1);
    expect(decision.events.every((event) => event.onBehalf === true)).toBe(true);
    expect(decision.events.at(-1)).toEqual({
      type: 'on_behalf.acted',
      command: 'task.prioritize',
      taskId,
      summary: 'Set the priority of “Fix tab group scroll” to high',
      onBehalf: true,
    });
    expect(harness.state.onBehalfActions?.at(-1)).toEqual({
      at: harness.now,
      command: 'task.prioritize',
      taskId,
      summary: 'Set the priority of “Fix tab group scroll” to high',
    });
  });

  test('a command sent by another task’s agent names that task on every event, the activity and the action', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const agentTask = createTask(harness, { request: 'Tidy the backlog' });
    const decision = harness.send(
      { type: 'task.message', taskId, text: 'Check the tab bar too.' },
      { onBehalf: true, byTask: agentTask }
    );
    expect(decision.events.every((event) => event.onBehalf === true && event.byTask === agentTask)).toBe(
      true
    );
    const mine = harness
      .task(taskId)
      .activity.filter((entry) => entry.at === harness.now && entry.actor === 'you');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((entry) => entry.onBehalf === true && entry.byTask === agentTask)).toBe(true);
    expect(harness.state.onBehalfActions?.at(-1)).toEqual({
      at: harness.now,
      command: 'task.message',
      taskId,
      summary: 'Messaged “Fix tab group scroll”',
      byTaskId: agentTask,
    });
  });

  test('an agent that reprioritises and completes its own task shows both on that task’s activity', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.prioritize', taskId, priority: 'high' }, { onBehalf: true, byTask: taskId });
    harness.send({ type: 'task.complete', taskId }, { onBehalf: true, byTask: taskId });
    const entries = harness
      .task(taskId)
      .activity.filter((entry) => entry.onBehalf)
      .map((entry) => [entry.actor, entry.text, entry.byTask]);
    expect(entries).toEqual([
      ['you', 'Set the priority to high', taskId],
      ['you', 'Marked done', taskId],
    ]);
    expect(harness.task(taskId).stage).toBe('done');
  });

  test('triage choosing the priority records no entry of yours', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const before = new Set(Object.keys(harness.state.tasks));
    harness.send({ type: 'task.create', request: 'Speed up the export', repoId: null });
    const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Speed up the export',
      repoId,
      size: 'small',
      branch: 'perf/export',
      waitsOn: [],
      priority: 'urgent',
    });
    expect(harness.task(taskId).priority).toBe('urgent');
    expect(harness.task(taskId).activity.some((entry) => entry.text.startsWith('Set the priority'))).toBe(
      false
    );
  });

  test('a command from the human themself is not stamped and records nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const decision = harness.send({ type: 'task.prioritize', taskId, priority: 'high' });
    expect(decision.events.some((event) => event.onBehalf)).toBe(false);
    expect(decision.events.some((event) => event.type === 'on_behalf.acted')).toBe(false);
  });

  test('a command that changes nothing records no action', () => {
    const harness = createHarness();
    const decision = actOnBehalf(harness, { type: 'schedule.remove', scheduleId: 'nope' });
    expect(decision.events).toEqual([]);
    expect(harness.state.onBehalfActions).toEqual([]);
  });

  test('a repository registered on the human’s behalf is stamped as theirs and records no action', () => {
    const harness = createHarness();
    const agentTask = createTask(harness, { request: 'Tidy the backlog' });
    const decision = harness.send(
      {
        type: 'repo.register',
        repo: {
          name: 'billing',
          path: '/code/billing',
          defaultBranch: 'main',
          remote: null,
          checkCommands: [],
        },
        projectName: null,
      },
      { onBehalf: true, byTask: agentTask }
    );
    expect(decision.events.map((event) => event.type)).toContain('repo.registered');
    expect(decision.events.every((event) => event.onBehalf === true && event.byTask === agentTask)).toBe(
      true
    );
    expect(Object.values(harness.state.repos).map((repo) => repo.name)).toContain('billing');
    expect(harness.state.onBehalfActions).toEqual([]);
  });

  test('marks only the human’s activity as done on their behalf, not what Shinsa did next', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    actOnBehalf(harness, { type: 'task.message', taskId, text: 'Smaller, please.' });
    const now = harness.task(taskId).activity.filter((entry) => entry.at === harness.now);
    expect(now.map((entry) => [entry.actor, entry.text, entry.onBehalf])).toEqual([
      ['you', 'Sent instructions', true],
      ['shinsa', 'Making the changes you asked for', undefined],
    ]);
    expect(
      harness
        .task(taskId)
        .activity.filter((entry) => entry.at < harness.now)
        .some((entry) => entry.onBehalf)
    ).toBe(false);
  });

  test('a message to a task that waits for you is left for its next agent, and closes no gate', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    const decision = harness.send(
      { type: 'task.message', taskId, text: 'Keep the old flag.' },
      { onBehalf: true, byTask: 'agent-task' }
    );
    expect(decision.events.map((event) => event.type)).toEqual(['task.messaged', 'on_behalf.acted']);
    expect(decision.effects).toEqual([]);
    expect(harness.state.gates[gate.id]?.status).toBe('open');
    expect(harness.task(taskId).stage).toBe('awaiting_plan');
    expect(lastAction(harness).summary).toBe(
      'Left a message for the next agent on “Fix tab group scroll”, which waits for you'
    );
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'revise', response: 'Smaller.' });
    expect(harness.activeRun(taskId).prompt).toContain(
      'The human added since:\n- Sent by an agent on the human’s behalf: Keep the old flag.'
    );
  });

  test('settings and repository fields only the human changes are refused on their behalf; the rest still change', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const settings: Required<Pick<Settings, (typeof HUMAN_ONLY_SETTINGS)[number]>> = {
      approvePlans: true,
      mergeMethod: 'rebase',
      taskBudgetUsd: 5,
      taskUsageLimit: 50,
      autoResume: false,
      snoozeLimited: false,
      accountSwitchAt: 90,
      fastMode: true,
      agentFastModes: { agent: true },
      delegationLimit: 4,
    };
    const fields: Required<Pick<Repo, (typeof HUMAN_ONLY_REPO_FIELDS)[number]>> = {
      checkCommands: ['bun test'],
      checksWaived: true,
      workspace: 'main_checkout',
      coverage: { mode: 'off' },
    };
    const refused: ShinsaCommand[] = [
      ...HUMAN_ONLY_SETTINGS.map(
        (key): ShinsaCommand => ({
          type: 'settings.change',
          patch: { maxFixRounds: 4, [key]: settings[key] },
        })
      ),
      ...HUMAN_ONLY_REPO_FIELDS.map(
        (field): ShinsaCommand => ({
          type: 'repo.update',
          repoId,
          patch: { name: 'renamed', [field]: fields[field] },
        })
      ),
    ];
    for (const command of refused) {
      const before = harness.events.length;
      expect(() => actOnBehalf(harness, command)).toThrow('Only the human changes');
      expect(harness.events).toHaveLength(before);
    }
    expect(() => actOnBehalf(harness, { type: 'settings.change', patch: { approvePlans: true } })).toThrow(
      'Only the human changes the settings approvePlans. Tell them what you would change and why.'
    );
    expect(() =>
      actOnBehalf(harness, { type: 'repo.update', repoId, patch: { checkCommands: [], checksWaived: true } })
    ).toThrow('Only the human changes the repository’s checkCommands, checksWaived.');
    actOnBehalf(harness, {
      type: 'settings.change',
      patch: { maxFixRounds: 4, defaultModel: 'sonnet', attentionLimit: 2, idleCompaction: false },
    });
    expect(harness.state.settings).toMatchObject({
      maxFixRounds: 4,
      defaultModel: 'sonnet',
      attentionLimit: 2,
    });
    actOnBehalf(harness, { type: 'repo.update', repoId, patch: { defaultBranch: 'develop' } });
    expect(harness.state.repos[repoId]?.defaultBranch).toBe('develop');
    harness.send({ type: 'settings.change', patch: { approvePlans: true, mergeMethod: 'rebase' } });
    harness.send({ type: 'repo.update', repoId, patch: { checkCommands: ['bun test'] } });
    expect(harness.state.settings).toMatchObject({ approvePlans: true, mergeMethod: 'rebase' });
    expect(harness.state.repos[repoId]?.checkCommands).toEqual(['bun test']);
  });
});

describe('the summary of each action', () => {
  test('names a task it created', () => {
    const harness = createHarness();
    actOnBehalf(harness, { type: 'task.create', request: 'Fix the login', repoId: null });
    const created = Object.values(harness.state.tasks)[0];
    expect(lastAction(harness)).toMatchObject({
      command: 'task.create',
      taskId: created?.id,
      summary: `Created “${created?.title}”`,
    });
  });

  test('names repositories, projects, the focus and settings', () => {
    const harness = createHarness();
    createTask(harness);
    const repoId = Object.keys(harness.state.repos)[0] ?? '';
    const projectId = Object.keys(harness.state.projects)[0] ?? '';
    const summaries: [ShinsaCommand, string][] = [
      [
        { type: 'repo.update', repoId, patch: { defaultBranch: 'develop' } },
        'Changed the repository paywall-next',
      ],
      [{ type: 'project.write', project: { name: 'Billing', color: 'blue' } }, 'Saved the project “Billing”'],
      [{ type: 'focus.change', projectId, until: null }, 'Focused on Superwall'],
      [{ type: 'focus.change', projectId: null, until: null }, 'Cleared the focus'],
      [
        { type: 'settings.change', patch: { maxFixRounds: 2, attentionLimit: 2 } },
        'Changed settings: maxFixRounds, attentionLimit',
      ],
      [{ type: 'project.remove', projectId }, 'Removed a project'],
      [{ type: 'repo.remove', repoId }, 'Removed a repository'],
    ];
    for (const [command, summary] of summaries) {
      actOnBehalf(harness, command);
      expect(lastAction(harness)).toMatchObject({ command: command.type, taskId: null, summary });
    }
  });

  test('names the task it changed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const other = createTask(harness, { request: 'Second' });
    const summaries: [ShinsaCommand, string][] = [
      [{ type: 'task.message', taskId, text: 'Look again.' }, 'Messaged “Fix tab group scroll”'],
      [{ type: 'task.wait_on', taskId, waitsOn: [other] }, 'Changed what “Fix tab group scroll” waits on'],
      [
        { type: 'task.bind_account', taskId: other, account: { id: 'acc-1', email: 'me@example.com' } },
        'Set “Second” to run on me@example.com',
      ],
      [
        { type: 'task.bind_account', taskId: other, account: { id: 'acc-2', email: null } },
        'Set “Second” to run on acc-2',
      ],
      [{ type: 'task.bind_account', taskId: other, account: null }, 'Let “Second” run on any account'],
      [{ type: 'task.retry', taskId: other }, 'Retried “Second”'],
      [{ type: 'task.complete', taskId: other }, 'Marked “Second” as done'],
      [{ type: 'task.cancel', taskId }, 'Cancelled “Fix tab group scroll”'],
    ];
    for (const [command, summary] of summaries) {
      actOnBehalf(harness, command);
      expect(lastAction(harness)).toMatchObject({ command: command.type, summary });
      expect(lastAction(harness).taskId).toBe('taskId' in command ? command.taskId : null);
    }
  });

  test('records nothing for a gate answered on its behalf, an agent’s question included', () => {
    const harness = createHarness();
    const reviewed = createTask(harness, { request: 'Reviewed' });
    reachReviewGate(harness, reviewed);
    const asked = createTask(harness, { request: 'Asked' });
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(asked).id,
      gateId: 'question-1',
      question: 'Which store?',
      context: null,
    });
    const before = harness.events.length;
    for (const [gateId, decision] of [
      [harness.openGate(reviewed).id, 'revise'],
      ['question-1', 'reply'],
    ] as const) {
      expect(() =>
        actOnBehalf(harness, { type: 'gate.answer', gateId, decision, response: 'Smaller.' })
      ).toThrow('Only the human decides this.');
    }
    expect(harness.events).toHaveLength(before);
    expect(harness.state.onBehalfActions).toEqual([]);
  });

  test('names the task of a suggested task it accepted or dismissed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const accepted = suggestFollowUp(harness, taskId, 'Cache the session');
    const dismissed = suggestFollowUp(harness, taskId, 'Retry the export');
    actOnBehalf(harness, { type: 'suggestion.accept', taskId, suggestionId: accepted, waitsOnThis: false });
    expect(lastAction(harness).summary).toBe('Added a suggested task of “Fix tab group scroll”');
    actOnBehalf(harness, { type: 'suggestion.dismiss', taskId, suggestionId: dismissed });
    expect(lastAction(harness).summary).toBe('Dismissed a suggested task of “Fix tab group scroll”');
  });

  test('names schedules it saved, changed, paused, resumed and deleted', () => {
    const harness = createHarness();
    writeSchedule(harness, null, 'Audit');
    expect(lastAction(harness).summary).toBe('Saved the schedule “Audit”');
    writeSchedule(harness, null, null);
    expect(lastAction(harness).summary).toBe('Saved the schedule “Schedule”');
    const scheduleId =
      Object.values(harness.state.schedules).find((entry) => entry.name === 'Audit')?.id ?? '';
    writeSchedule(harness, scheduleId, null);
    expect(lastAction(harness).summary).toBe('Changed a schedule');
    actOnBehalf(harness, { type: 'schedule.enable', scheduleId, enabled: false });
    expect(lastAction(harness).summary).toBe('Paused the schedule “Audit”');
    actOnBehalf(harness, { type: 'schedule.enable', scheduleId, enabled: true });
    expect(lastAction(harness).summary).toBe('Resumed the schedule “Audit”');
    actOnBehalf(harness, { type: 'schedule.remove', scheduleId });
    expect(lastAction(harness)).toMatchObject({ taskId: null, summary: 'Deleted a schedule' });
  });

  test('names what it did to a quiet agent, a round, a wait and a delegation, finding the task through the run', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const runId = harness.activeRun(taskId).id;
    actOnBehalf(harness, { type: 'run.snooze_silence', runId, until: harness.now + 60_000 });
    expect(lastAction(harness)).toMatchObject({
      command: 'run.snooze_silence',
      taskId,
      summary: 'Snoozed the quiet agent on “Fix tab group scroll”',
    });
    actOnBehalf(harness, { type: 'run.dismiss_silence', runId });
    expect(lastAction(harness).summary).toBe('Dismissed the quiet agent on “Fix tab group scroll”');
    harness.send({
      type: 'agent.delegate',
      runId,
      requestKey: 'k1',
      title: 'Check the copy',
      brief: 'Read the strings and report.',
      role: 'reviewer',
      mode: 'async',
      isolation: 'shared',
      baseCommit: null,
      provider: null,
      model: null,
    });
    const delegated = Object.values(harness.state.runs).find((run) => run.delegation)?.id ?? '';
    actOnBehalf(harness, { type: 'delegation.cancel', runId: delegated });
    expect(lastAction(harness).summary).toBe('Stopped a delegation on “Fix tab group scroll”');
    harness.send({
      type: 'agent.wait_for',
      runId,
      checkInMinutes: 10,
      notes: 'The deploy.',
      timeoutMinutes: null,
      maxAttempts: null,
    });
    actOnBehalf(harness, { type: 'monitor.check_in_now', taskId });
    expect(lastAction(harness).summary).toBe('Checked now what “Fix tab group scroll” waits for');
    harness.send({ type: 'task.message', taskId, text: 'Also the flicker.', kind: 'new_round' });
    actOnBehalf(harness, { type: 'round.ship', taskId, number: 2, shipping: 'stacked' });
    expect(lastAction(harness).summary).toBe(
      'Set round 2 of “Fix tab group scroll” to ship as its own stacked pull request'
    );
    actOnBehalf(harness, { type: 'round.ship', taskId, number: 2, shipping: 'onto_pull_request' });
    expect(lastAction(harness).summary).toBe(
      'Set round 2 of “Fix tab group scroll” to ship onto the open pull request'
    );
    harness.send({ type: 'task.message', taskId, text: 'Rename the settings page.', kind: 'separate_task' });
    const split = harness.task(taskId).suggestions?.find((suggestion) => suggestion.splitOff)?.id ?? '';
    actOnBehalf(harness, { type: 'suggestion.keep', taskId, suggestionId: split });
    expect(lastAction(harness).summary).toBe('Kept a split-off of “Fix tab group scroll” as its next round');
  });

  test('names what it did to a task waiting for a usage limit', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'Limit.',
      failure: {
        class: 'usage_limit',
        message: 'Claude’s usage limit is reached.',
        code: 'rate_limit',
        retryable: true,
        resetAt: harness.now + 3_600_000,
        account: null,
      },
    });
    actOnBehalf(harness, { type: 'usage_wait.change', taskId, autoResume: false });
    expect(lastAction(harness).summary).toBe(
      'Set “Fix tab group scroll” to wait for you when the usage limit resets'
    );
    actOnBehalf(harness, { type: 'usage_wait.change', taskId, autoResume: true });
    expect(lastAction(harness).summary).toBe(
      'Set “Fix tab group scroll” to resume on its own when the usage limit resets'
    );
    actOnBehalf(harness, { type: 'usage_wait.resume_now', taskId });
    expect(lastAction(harness).summary).toBe(
      'Resumed “Fix tab group scroll” without waiting for the usage limit'
    );
  });
});
