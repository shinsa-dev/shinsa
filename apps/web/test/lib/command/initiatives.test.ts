import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { listInitiativeSections, listTaskInitiativeCommands } from '@/lib/command/initiatives.ts';
import type { Command } from '@/lib/command/registry.ts';
import { useInitiativeDialog } from '@/lib/initiatives/draft.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createInitiative, createShinsaState, createTask } from '../../support/state.ts';

const ALL = new Set(['initiative.write', 'initiative.adopt_task', 'task.join_initiative']);

const SPLIT = createInitiative({
  id: 'split',
  name: 'Chat split',
  phases: [{ id: 'p1', name: 'Dock' }],
  leadTaskId: 'lead-split',
});

const BILLING = createInitiative({ id: 'billing', name: 'Billing', leadTaskId: 'lead-billing' });

const LEAD_SPLIT = createTask({
  id: 'lead-split',
  handle: 'SW-1',
  pipeline: ['lead'],
  stage: 'leading',
  initiativeId: 'split',
});

const LEAD_BILLING = createTask({
  id: 'lead-billing',
  pipeline: ['lead'],
  stage: 'leading',
  initiativeId: 'billing',
});

function find(commands: Command[], id: string) {
  const command = commands.find((each) => each.id === id);
  if (!command) throw new Error(`No command ${id}`);
  return command;
}

function pick(command: Command, value: string) {
  if (command.kind !== 'choice') throw new Error('Not a choice');
  command.pick(value);
}

function run(command: Command) {
  if (command.kind !== 'run') throw new Error('Not a run');
  command.run();
}

describe('the Initiatives section', () => {
  it('finds each open initiative by name and opens its lead task', () => {
    const state = createShinsaState({ initiatives: [SPLIT, BILLING], tasks: [LEAD_SPLIT] });
    const [section] = listInitiativeSections(state, { name: 'task', reference: 'SW-1' });
    const commands = section?.commands ?? [];
    expect(commands.map((command) => command.label)).toEqual(['Chat split']);
    expect(find(commands, 'initiative.split')).toMatchObject({
      kind: 'go',
      to: '/tasks/SW-1',
      current: true,
      searchOnly: true,
    });
  });

  it('is left out without an open initiative', () => {
    expect(listInitiativeSections(createShinsaState({}), { name: 'home' })).toEqual([]);
  });
});

describe('a task’s initiative commands', () => {
  it('offers adding to an initiative or making one from a task outside any', () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't' });
    const state = createShinsaState({ initiatives: [SPLIT], tasks: [task, LEAD_SPLIT] });
    const commands = listTaskInitiativeCommands(state, task, ALL);
    expect(commands.map((command) => command.label)).toEqual([
      'Add to an initiative',
      'Make an initiative from this task',
    ]);
    pick(find(commands, 'task.t.initiative.join'), 'split');
    pick(find(commands, 'task.t.initiative.join'), 'gone');
    run(find(commands, 'task.t.initiative.adopt'));
    expect(spies.sent.mock.calls.map((call) => call[0].type)).toEqual([
      'task.join_initiative',
      'initiative.adopt_task',
    ]);
  });

  it('offers a member moving, changing phase, opening and leaving', () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't', initiativeId: 'split', initiativePhaseId: 'p1' });
    const state = createShinsaState({
      initiatives: [SPLIT, BILLING],
      tasks: [task, LEAD_SPLIT, LEAD_BILLING],
    });
    const commands = listTaskInitiativeCommands(state, task, ALL);
    expect(commands.map((command) => command.label)).toEqual([
      'Move to another initiative',
      'Move to another phase of Chat split',
      'Open the initiative Chat split',
      'Take out of the initiative',
    ]);
    const phase = find(commands, 'task.t.initiative.phase');
    expect(phase).toMatchObject({ kind: 'choice', value: 'p1' });
    pick(phase, '');
    run(find(commands, 'task.t.initiative.leave'));
    expect(spies.sent.mock.calls.map((call) => call[0])).toEqual([
      { type: 'task.join_initiative', taskId: 't', initiativeId: 'split', phaseId: null },
      { type: 'task.join_initiative', taskId: 't', initiativeId: null, phaseId: null },
    ]);
  });

  it('offers its own lead only editing the initiative', () => {
    const state = createShinsaState({ initiatives: [SPLIT], tasks: [LEAD_SPLIT] });
    const commands = listTaskInitiativeCommands(state, LEAD_SPLIT, ALL);
    expect(commands.map((command) => command.label)).toEqual(['Edit the initiative']);
    const { result } = renderHook(() => useInitiativeDialog());
    act(() => run(find(commands, 'task.lead-split.initiative.edit')));
    expect(result.current).toEqual({ initiativeId: 'split' });
    expect(
      listTaskInitiativeCommands(state, LEAD_SPLIT, new Set(['task.join_initiative'])).map((each) => each.id)
    ).toEqual([]);
  });

  it('offers a member of an initiative whose lead is gone nothing but moving', () => {
    const task = createTask({ id: 't', initiativeId: 'split' });
    const state = createShinsaState({ initiatives: [SPLIT, BILLING], tasks: [task, LEAD_BILLING] });
    expect(listTaskInitiativeCommands(state, task, ALL).map((command) => command.label)).toEqual([
      'Move to another initiative',
    ]);
  });

  it('leaves out the phase for an initiative without phases and everything on an older engine', () => {
    const task = createTask({ id: 't', initiativeId: 'billing' });
    const state = createShinsaState({ initiatives: [BILLING], tasks: [task, LEAD_BILLING] });
    const withoutPhases = listTaskInitiativeCommands(state, task, ALL);
    expect(withoutPhases.map((command) => command.label)).toEqual([
      'Open the initiative Billing',
      'Take out of the initiative',
    ]);
    expect(listTaskInitiativeCommands(state, task, new Set())).toEqual([]);
  });
});

const TEAMS = [
  { id: 'team1', name: 'Studio' },
  { id: 'team2', name: 'Core' },
];

const KAI_SPLIT = {
  id: 'kai-split',
  name: 'Kai’s split',
  description: '',
  phases: [{ id: 'p1', name: 'Session and transport' }],
  leadTaskId: 'kai-lead',
  report: null,
  finished: false,
  updatedAt: 1,
  teamId: 'team1',
  instanceId: 'kai-machine',
};

const TEAM_FEED = {
  machines: [],
  tasks: [],
  initiatives: [
    KAI_SPLIT,
    { ...KAI_SPLIT, teamId: 'team2' },
    { ...KAI_SPLIT, id: 'old', finished: true },
    { ...KAI_SPLIT, id: 'far', teamId: 'team9' },
  ],
};

const TEAM_ALL = new Set([...ALL, 'initiative.add_to_team']);

describe('teammates’ initiatives in ⌘K', () => {
  it('finds each open one of your teams once, and opens its lead read-only', () => {
    const [section] = listInitiativeSections(
      createShinsaState({}),
      { name: 'team-task', teamId: 'team1', instanceId: 'kai-machine', taskId: 'kai-lead' },
      { feed: TEAM_FEED, teams: TEAMS }
    );
    expect(section?.commands.map((command) => [command.label, command.hint, command.current])).toEqual([
      ['Kai’s split', 'A teammate’s initiative', true],
    ]);
    const command = section?.commands[0];
    if (command?.kind !== 'go') throw new Error('Not a go');
    expect(command.to).toBe('/teams/team1/kai-machine/kai-lead');
  });

  it('offers a teammate’s initiative beside yours to join, and joins it with its team and machine', () => {
    const spies = spyOnCommands();
    const state = createShinsaState({ initiatives: [SPLIT], tasks: [LEAD_SPLIT] });
    const task = createTask({ id: 't' });
    const join = find(
      listTaskInitiativeCommands(state, task, ALL, { feed: TEAM_FEED, teams: TEAMS }),
      'task.t.initiative.join'
    );
    if (join.kind !== 'choice') throw new Error('Not a choice');
    expect(join.options.map((option) => [option.label, option.hint])).toEqual([
      ['Chat split', undefined],
      ['Kai’s split', 'A teammate’s initiative'],
    ]);
    pick(join, 'team:team1:kai-machine:kai-split');
    pick(join, 'split');
    expect(spies.sent.mock.calls.map(([command]) => command)).toEqual([
      {
        type: 'task.join_initiative',
        taskId: 't',
        initiativeId: 'kai-split',
        phaseId: null,
        team: { teamId: 'team1', instanceId: 'kai-machine', name: 'Kai’s split' },
      },
      { type: 'task.join_initiative', taskId: 't', initiativeId: 'split', phaseId: null },
    ]);
  });

  it('offers a member of a teammate’s initiative its phase, its lead and leaving, and no Make an initiative', () => {
    const spies = spyOnCommands();
    const member = createTask({
      id: 'm',
      teamInitiative: {
        teamId: 'team1',
        instanceId: 'kai-machine',
        initiativeId: 'kai-split',
        phaseId: 'p1',
        name: 'Kai’s split',
      },
    });
    const commands = listTaskInitiativeCommands(createShinsaState({}), member, ALL, {
      feed: TEAM_FEED,
      teams: TEAMS,
    });
    expect(commands.map((command) => command.id)).toEqual([
      'task.m.initiative.phase',
      'task.m.initiative.open',
      'task.m.initiative.leave',
    ]);
    const phase = find(commands, 'task.m.initiative.phase');
    if (phase.kind !== 'choice') throw new Error('Not a choice');
    expect(phase.value).toBe('p1');
    pick(phase, '');
    const open = find(commands, 'task.m.initiative.open');
    if (open.kind !== 'go') throw new Error('Not a go');
    expect(open.to).toBe('/teams/team1/kai-machine/kai-lead');
    run(find(commands, 'task.m.initiative.leave'));
    expect(spies.sent.mock.calls.map(([command]) => command)).toEqual([
      {
        type: 'task.join_initiative',
        taskId: 'm',
        initiativeId: 'kai-split',
        phaseId: null,
        team: { teamId: 'team1', instanceId: 'kai-machine', name: 'Kai’s split' },
      },
      { type: 'task.join_initiative', taskId: 'm', initiativeId: null, phaseId: null },
    ]);
  });

  it('still lets a member leave while the teammate’s machine is away, and gives a phaseless one no phase', () => {
    const member = createTask({
      id: 'm',
      teamInitiative: {
        teamId: 'team1',
        instanceId: 'kai-machine',
        initiativeId: 'kai-split',
        phaseId: null,
        name: 'Kai’s split',
      },
    });
    const away = listTaskInitiativeCommands(createShinsaState({}), member, ALL);
    expect(away.map((command) => command.id)).toEqual(['task.m.initiative.leave']);
    const plain = listTaskInitiativeCommands(createShinsaState({}), member, ALL, {
      feed: { machines: [], tasks: [], initiatives: [{ ...KAI_SPLIT, phases: [] }] },
      teams: TEAMS,
    });
    expect(plain.map((command) => command.id)).toEqual(['task.m.initiative.open', 'task.m.initiative.leave']);
  });

  it('lets the lead share its initiative with each team or stop, only where the engine can', () => {
    const spies = spyOnCommands();
    const state = createShinsaState({
      initiatives: [{ ...SPLIT, teamIds: ['team2'] }],
      tasks: [LEAD_SPLIT],
    });
    const teams = { feed: TEAM_FEED, teams: TEAMS };
    const commands = listTaskInitiativeCommands(state, LEAD_SPLIT, TEAM_ALL, teams);
    expect(commands.map((command) => command.label)).toEqual([
      'Edit the initiative',
      'Share the initiative with Studio',
      'Stop sharing the initiative with Core',
    ]);
    run(find(commands, 'task.lead-split.initiative.team.team1'));
    run(find(commands, 'task.lead-split.initiative.team.team2'));
    expect(spies.sent.mock.calls.map(([command]) => command)).toEqual([
      { type: 'initiative.add_to_team', initiativeId: 'split', teamId: 'team1' },
      { type: 'initiative.remove_from_team', initiativeId: 'split', teamId: 'team2' },
    ]);
    expect(listTaskInitiativeCommands(state, LEAD_SPLIT, ALL, teams).map((command) => command.label)).toEqual(
      ['Edit the initiative']
    );
  });
});
