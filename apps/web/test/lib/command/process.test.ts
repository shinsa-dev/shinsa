import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Monitor, TaskSuggestion } from '@shinsa/core';
import { listProcessCommands } from '@/lib/command/process.ts';
import type { Command } from '@/lib/command/registry.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRound } from '../../support/rounds.ts';
import { createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

function run(command: Command | undefined) {
  if (command?.kind !== 'run') throw new Error('not a run command');
  command.run();
}

const MONITOR: Monitor = {
  id: 'm',
  runId: 'r',
  role: 'agent',
  phaseIndex: 0,
  notes: 'The deploy.',
  armedAt: 0,
  nextCheckAt: NOW + 60_000,
  timeoutAt: NOW + 600_000,
  attempts: 0,
  maxAttempts: 3,
  status: 'armed',
};

const SUGGESTION: TaskSuggestion = {
  id: 's',
  runId: null,
  title: 'Cache it',
  request: 'Cache the export.',
  why: 'It is slow.',
  waitsOnThis: true,
  status: 'open',
  createdTaskId: null,
  suggestedAt: 1,
};

describe('process commands', () => {
  it('offers check in now, the quiet-agent warning and each open suggested task', () => {
    const task = createTask({ id: 't', monitor: MONITOR, suggestions: [SUGGESTION] });
    const quiet = createRun({
      id: 'r',
      taskId: 't',
      status: 'running',
      silence: { since: NOW - 10 * 60_000, snoozedUntil: null, dismissed: false },
    });
    const state = createShinsaState({ tasks: [task], runs: [quiet] });
    const commands = listProcessCommands(state, task, NOW);
    expect(commands.map((command) => command.label)).toEqual([
      'Check in now',
      'Snooze the quiet-agent warning on the agent',
      'Dismiss the quiet-agent warning on the agent',
      'Add the suggested task “Cache it”',
      'Dismiss the suggested task “Cache it”',
    ]);
    for (const command of commands) if (command.kind === 'run') run(command);
    expect(spies.sent.mock.calls.map(([command]) => command.type)).toEqual([
      'monitor.check_in_now',
      'run.snooze_silence',
      'run.dismiss_silence',
      'suggestion.dismiss',
    ]);
  });

  it('names each quiet run of a task in its own warning commands', () => {
    const task = createTask({ id: 't' });
    const silence = { since: NOW - 10 * 60_000, snoozedUntil: null, dismissed: false };
    const runs = [
      createRun({ id: 'r1', taskId: 't', status: 'running', silence }),
      createRun({ id: 'r2', taskId: 't', role: 'reviewer', status: 'running', silence }),
    ];
    const commands = listProcessCommands(createShinsaState({ tasks: [task], runs }), task, NOW);
    expect(commands.map((command) => command.label)).toEqual([
      'Snooze the quiet-agent warning on the agent',
      'Dismiss the quiet-agent warning on the agent',
      'Snooze the quiet-agent warning on the reviewer',
      'Dismiss the quiet-agent warning on the reviewer',
    ]);
    expect(new Set(commands.map((command) => command.id)).size).toBe(4);
    for (const command of commands) run(command);
    expect(
      spies.sent.mock.calls.map(([command]) => [command.type, 'runId' in command && command.runId])
    ).toEqual([
      ['run.snooze_silence', 'r1'],
      ['run.dismiss_silence', 'r1'],
      ['run.snooze_silence', 'r2'],
      ['run.dismiss_silence', 'r2'],
    ]);
  });

  it('asks when an added suggested task starts, the agent’s suggestion first, and sends the one you pick', () => {
    for (const waitsOnThis of [true, false]) {
      spies.sent.mockClear();
      const task = createTask({ id: 't', suggestions: [{ ...SUGGESTION, waitsOnThis }] });
      const add = listProcessCommands(createShinsaState({ tasks: [task] }), task, NOW)[0];
      if (add?.kind !== 'page' || add.page.kind !== 'list') throw new Error('not a list page');
      const choices = add.page.sections.flatMap((section) => section.commands);
      expect(choices.map((choice) => [choice.label, choice.hint])).toEqual(
        waitsOnThis
          ? [
              ['After this task merges', 'Suggested'],
              ['Start now', undefined],
              ['Backlog', undefined],
            ]
          : [
              ['Start now', 'Suggested'],
              ['After this task merges', undefined],
              ['Backlog', undefined],
            ]
      );
      for (const choice of choices) run(choice);
      expect(spies.sent.mock.calls.map(([command]) => command)).toEqual([
        { type: 'suggestion.accept', taskId: 't', suggestionId: 's', waitsOnThis },
        { type: 'suggestion.accept', taskId: 't', suggestionId: 's', waitsOnThis: !waitsOnThis },
        { type: 'suggestion.accept', taskId: 't', suggestionId: 's', waitsOnThis: false, backlog: true },
      ] as never);
    }
  });

  it('keeps a separate-task suggestion here, and switches how a waiting round ships', () => {
    const task = createTask({
      id: 't',
      stage: 'building',
      suggestions: [{ ...SUGGESTION, splitOff: true }],
      pullRequest: {
        number: 12,
        url: 'https://github.com/o/r/pull/12',
        state: 'open',
        checks: 'passing',
        unresolvedComments: 0,
        mergeable: true,
        updatedAt: 0,
      },
      rounds: [
        createRound({ number: 1, status: 'active', outcome: null }),
        createRound({ number: 2, status: 'waiting', startedAt: null, pullRequest: null, outcome: null }),
      ],
    });
    const commands = listProcessCommands(createShinsaState({ tasks: [task] }), task, NOW);
    expect(commands.map((command) => command.label)).toEqual([
      'Add the suggested task “Cache it”',
      'Keep “Cache it” in this task',
      'Ship round 2 as a stacked pull request',
    ]);
    for (const command of commands) if (command.kind === 'run') run(command);
    const stacked = { ...task, rounds: [task.rounds?.[0], { ...task.rounds?.[1], shipping: 'stacked' }] };
    const back = listProcessCommands(
      createShinsaState({ tasks: [stacked as never] }),
      stacked as never,
      NOW
    ).at(-1);
    expect(back?.label).toBe('Ship round 2 onto #12');
    run(back);
    expect(spies.sent.mock.calls.map(([command]) => command)).toEqual([
      { type: 'suggestion.keep', taskId: 't', suggestionId: 's' },
      { type: 'round.ship', taskId: 't', number: 2, shipping: 'stacked' },
      { type: 'round.ship', taskId: 't', number: 2, shipping: 'onto_pull_request' },
    ] as never);
  });

  it('offers nothing for a quiet run that is fine or a task with nothing pending', () => {
    const task = createTask({ id: 't' });
    const fresh = createRun({
      id: 'r',
      taskId: 't',
      status: 'running',
      silence: { since: NOW - 60_000, snoozedUntil: null, dismissed: false },
    });
    expect(listProcessCommands(createShinsaState({ tasks: [task], runs: [fresh] }), task, NOW)).toEqual([]);
  });

  it('stops each delegated task that still works, and nothing that ended', () => {
    const task = createTask({ id: 't' });
    const delegation = {
      parentRunId: 'step',
      depth: 1,
      requestKey: 'k',
      title: 'Survey the tests',
      brief: 'b',
      mode: 'async' as const,
      wake: 'always' as const,
      isolation: 'shared' as const,
      baseCommit: null,
      delivery: 'none' as const,
      question: null,
      requestedAt: NOW,
    };
    const live = createRun({ id: 'live', taskId: 't', role: 'reviewer', status: 'running', delegation });
    const ended = createRun({ id: 'ended', taskId: 't', role: 'reviewer', endedAt: NOW, delegation });
    const commands = listProcessCommands(
      createShinsaState({ tasks: [task], runs: [live, ended] }),
      task,
      NOW
    );
    expect(commands.map((command) => [command.label, command.hint])).toEqual([
      ['Stop “Survey the tests” and what it delegated', 'Reviewer'],
    ]);
    for (const command of commands) run(command);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'delegation.cancel', runId: 'live' }, 'Stopped.'],
    ] as never);
  });
});
