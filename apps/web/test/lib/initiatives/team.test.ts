import { describe, expect, it } from 'bun:test';
import {
  type InitiativeTeamMember,
  resolveInitiativeSheet,
  type Task,
  type TeamFeedInitiative,
  type TeamFeedSnapshot,
} from '@shinsa/core';
import {
  changeTeamPhase,
  describeTeamInitiativeLabel,
  isOwnTeamInitiativeTask,
  isTeamInitiativeEntry,
  joinTeamInitiative,
  leaveTeamInitiative,
  listTeamInitiativeChoices,
  listTeamShareChoices,
  resolveTeamLeadPath,
  selectLeadTeamInitiative,
  selectTaskTeamInitiative,
  shareInitiative,
} from '@/lib/initiatives/team.ts';
import {
  hasTeamRows,
  listInitiativeTaskSections,
  listTeamInitiativeTaskSections,
} from '@/lib/initiatives/view.ts';
import { resolveTeamTaskState } from '@/lib/teams/feeds.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createGate, createInitiative, createShinsaState, createTask, NOW } from '../../support/state.ts';
import { createTeamFeedTask } from '../teams/machine.ts';

const TEAMS = [
  { id: 'team1', name: 'Studio' },
  { id: 'team2', name: 'Core' },
];

const PHASES = [
  { id: 'p1', name: 'Session and transport' },
  { id: 'p2', name: 'Tools in the chat' },
];

function teamInitiative(changes: Partial<TeamFeedInitiative> = {}): TeamFeedInitiative {
  return {
    id: 'split',
    name: 'Chat split',
    description: '',
    phases: PHASES,
    leadTaskId: 'lead-split',
    report: { narrative: 'Phase one is building.', at: NOW },
    finished: false,
    updatedAt: NOW,
    teamId: 'team1',
    instanceId: 'owner-machine',
    ...changes,
  };
}

const SPLIT = teamInitiative();

function feedOf(initiatives: TeamFeedInitiative[]): TeamFeedSnapshot {
  return { machines: [], tasks: [], initiatives };
}

function teamEntry(task: Task, changes: Parameters<typeof createTeamFeedTask>[0] = {}) {
  const entry = createTeamFeedTask({ task, ...changes });
  return { entry, state: resolveTeamTaskState(entry), heldAt: null };
}

function ids(sections: ReturnType<typeof listInitiativeTaskSections>) {
  return sections.map((section) => [section.group.title, section.entries.map((entry) => entry.task.id)]);
}

describe('a teammate’s initiatives', () => {
  const feed = feedOf([
    SPLIT,
    teamInitiative({ teamId: 'team2' }),
    teamInitiative({ id: 'billing', name: 'Billing', leadTaskId: 'lead-billing' }),
    teamInitiative({ id: 'old', name: 'Docs', finished: true }),
    teamInitiative({ id: 'other', name: 'Other team', teamId: 'team9' }),
  ]);

  it('offers the open ones of your teams once each, by name, but the one the task is in', () => {
    const task = createTask({ id: 't' });
    expect(listTeamInitiativeChoices(feed, TEAMS, task).map((each) => [each.id, each.teamId])).toEqual([
      ['billing', 'team1'],
      ['split', 'team1'],
    ]);
    const joined = createTask({
      id: 't',
      teamInitiative: {
        teamId: 'team1',
        instanceId: 'owner-machine',
        initiativeId: 'split',
        phaseId: null,
        name: 'Chat split',
      },
    });
    expect(listTeamInitiativeChoices(feed, TEAMS, joined).map((each) => each.id)).toEqual(['billing']);
    expect(selectTaskTeamInitiative(feed, joined)).toBe(SPLIT);
    expect(selectTaskTeamInitiative(feed, task)).toBeNull();
    expect(selectTaskTeamInitiative(feedOf([]), joined)).toBeNull();
    expect(isOwnTeamInitiativeTask(joined, SPLIT)).toBe(true);
    expect(isOwnTeamInitiativeTask(task, SPLIT)).toBe(false);
  });

  it('offers none to a lead task, and none from an empty feed', () => {
    const lead = createTask({ id: 'lead', pipeline: ['lead'], stage: 'leading' });
    expect(listTeamInitiativeChoices(feed, TEAMS, lead)).toEqual([]);
    expect(listTeamInitiativeChoices({ machines: [], tasks: [] }, TEAMS, createTask({ id: 't' }))).toEqual(
      []
    );
  });

  it('finds the initiative a lead task leads, and opens its lead read-only on the team page', () => {
    expect(selectLeadTeamInitiative(feed, { id: 'lead-billing' })?.id).toBe('billing');
    expect(selectLeadTeamInitiative({ machines: [], tasks: [] }, { id: 'lead-billing' })).toBeNull();
    expect(resolveTeamLeadPath(SPLIT)).toBe('/teams/team1/owner-machine/lead-split');
  });

  it('names the phase beside the initiative, or the initiative alone', () => {
    expect(describeTeamInitiativeLabel(SPLIT, 'p2')).toBe('Chat split · Tools in the chat');
    expect(describeTeamInitiativeLabel(SPLIT, null)).toBe('Chat split');
  });

  it('knows a teammate’s task in it by the machine its reference names, or the machine it is on', () => {
    const owner = createTeamFeedTask({
      instanceId: 'owner-machine',
      initiative: { instanceId: null, initiativeId: 'split', phaseId: null },
    });
    const third = createTeamFeedTask({
      instanceId: 'lee-machine',
      initiative: { instanceId: 'owner-machine', initiativeId: 'split', phaseId: 'p1' },
    });
    expect(isTeamInitiativeEntry(owner, SPLIT)).toBe(true);
    expect(isTeamInitiativeEntry(third, SPLIT)).toBe(true);
    expect(isTeamInitiativeEntry({ ...third, teamId: 'team2' }, SPLIT)).toBe(false);
    expect(isTeamInitiativeEntry({ ...owner, initiative: null }, SPLIT)).toBe(false);
    expect(isTeamInitiativeEntry({ ...owner, instanceId: 'lee-machine' }, SPLIT)).toBe(false);
    const lead = createTeamFeedTask({
      task: createTask({ id: 'lead-split' }),
      instanceId: 'owner-machine',
      initiative: { instanceId: null, initiativeId: 'split', phaseId: null },
    });
    expect(isTeamInitiativeEntry(lead, SPLIT)).toBe(false);
  });

  it('joins, moves within and leaves a teammate’s initiative, naming its team and machine', async () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't' });
    await joinTeamInitiative(task, SPLIT);
    await changeTeamPhase(task, SPLIT, 'p1');
    await changeTeamPhase(task, SPLIT, null);
    await leaveTeamInitiative(
      createTask({
        id: 't',
        teamInitiative: {
          teamId: 'team1',
          instanceId: 'owner-machine',
          initiativeId: 'split',
          phaseId: null,
          name: 'Chat split',
        },
      })
    );
    await leaveTeamInitiative(task);
    const team = { teamId: 'team1', instanceId: 'owner-machine', name: 'Chat split' };
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: 'split', phaseId: null, team },
        'Added to “Chat split”.',
      ],
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: 'split', phaseId: 'p1', team },
        'Moved to the phase “Session and transport”.',
      ],
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: 'split', phaseId: null, team },
        'Taken out of its phase.',
      ],
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: null, phaseId: null },
        'Taken out of “Chat split”.',
      ],
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: null, phaseId: null },
        'Taken out of “A teammate’s initiative”.',
      ],
    ]);
  });
});

describe('sharing an initiative', () => {
  const initiative = createInitiative({ id: 'split', name: 'Chat split', teamIds: ['team1'] });

  it('ticks the teams it is shared with', () => {
    expect(listTeamShareChoices(initiative, TEAMS)).toEqual([
      { team: { id: 'team1', name: 'Studio' }, shared: true },
      { team: { id: 'team2', name: 'Core' }, shared: false },
    ]);
  });

  it('shares with a team and stops sharing', async () => {
    const spies = spyOnCommands();
    await shareInitiative(initiative, { id: 'team2', name: 'Core' }, true);
    await shareInitiative(initiative, { id: 'team1', name: 'Studio' }, false);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'initiative.add_to_team', initiativeId: 'split', teamId: 'team2' }, 'Shared with Core.'],
      [
        { type: 'initiative.remove_from_team', initiativeId: 'split', teamId: 'team1' },
        'Stopped sharing with Studio.',
      ],
    ]);
  });
});

function member(changes: Partial<InitiativeTeamMember>): InitiativeTeamMember {
  return {
    teamId: 'team1',
    instanceId: 'kai-machine',
    taskId: 'kai-1',
    handle: 'PL-3',
    title: 'Sign webhooks',
    owner: 'kai',
    stage: 'planning',
    phaseId: null,
    gate: null,
    closedAt: null,
    ...changes,
  };
}

describe('the lead’s table with teammates’ tasks', () => {
  const kai = {
    building: teamEntry(createTask({ id: 'kai-build', stage: 'building' }), { instanceId: 'kai-machine' }),
    waiting: teamEntry(createTask({ id: 'kai-wait', stage: 'waiting_on_tasks' }), {
      instanceId: 'kai-machine',
    }),
    review: teamEntry(createTask({ id: 'kai-review', stage: 'awaiting_review' }), {
      instanceId: 'kai-machine',
      gates: [createGate({ id: 'kg', taskId: 'kai-review', type: 'review' })],
    }),
    merged: teamEntry(createTask({ id: 'kai-merged', stage: 'merged', closedAt: NOW }), {
      instanceId: 'kai-machine',
    }),
    dropped: teamEntry(createTask({ id: 'kai-dropped', stage: 'cancelled', closedAt: NOW }), {
      instanceId: 'kai-machine',
    }),
  };
  const state = createShinsaState({
    initiatives: [
      createInitiative({
        id: 'split',
        phases: PHASES,
        leadTaskId: 'lead-split',
        teamIds: ['team1'],
        teamMembers: [
          member({ taskId: 'kai-build', stage: 'building' }),
          member({ taskId: 'kai-wait', stage: 'waiting_on_tasks', phaseId: 'p2' }),
          member({ taskId: 'kai-review', stage: 'awaiting_review', gate: 'review' }),
          member({ taskId: 'kai-merged', stage: 'merged', closedAt: NOW }),
          member({ taskId: 'kai-dropped', stage: 'cancelled', closedAt: NOW }),
          member({ taskId: 'kai-gone', stage: 'planning' }),
        ],
      }),
    ],
    tasks: [
      createTask({ id: 'lead-split', pipeline: ['lead'], stage: 'leading', initiativeId: 'split' }),
      createTask({ id: 'mine', stage: 'waiting_on_tasks', initiativeId: 'split', initiativePhaseId: 'p2' }),
    ],
  });
  const sheet = resolveInitiativeSheet(state, 'split', NOW);
  if (!sheet) throw new Error('No sheet');

  it('puts each teammate’s task where theirs stands, beside yours in its phase, and skips one the feed lacks', () => {
    const sections = listInitiativeTaskSections(state, sheet, Object.values(kai));
    expect(ids(sections)).toEqual([
      ['Changes to review', ['kai-review']],
      ['In progress', ['kai-build']],
      ['Tools in the chat', ['mine', 'kai-wait']],
      ['Done', ['kai-merged']],
      ['Cancelled', ['kai-dropped']],
    ]);
    expect(hasTeamRows(sections)).toBe(true);
    expect(hasTeamRows(listInitiativeTaskSections(state, sheet))).toBe(false);
  });
});

describe('a teammate’s initiative, read-only', () => {
  const ref = { teamId: 'team1', instanceId: 'owner-machine', initiativeId: 'split', name: 'Chat split' };
  const state = createShinsaState({
    tasks: [
      createTask({ id: 'mine-build', stage: 'building', teamInitiative: { ...ref, phaseId: null } }),
      createTask({ id: 'mine-next', stage: 'waiting_on_tasks', teamInitiative: { ...ref, phaseId: 'p1' } }),
      createTask({ id: 'mine-review', stage: 'awaiting_review', teamInitiative: { ...ref, phaseId: null } }),
      createTask({
        id: 'mine-merged',
        stage: 'merged',
        closedAt: NOW,
        teamInitiative: { ...ref, phaseId: null },
      }),
      createTask({
        id: 'mine-dropped',
        stage: 'cancelled',
        closedAt: NOW,
        teamInitiative: { ...ref, phaseId: 'x' },
      }),
      createTask({ id: 'outside', stage: 'building' }),
    ],
    gates: [createGate({ id: 'mg', taskId: 'mine-review', type: 'review' })],
  });
  const inIt = (phaseId: string | null) => ({ instanceId: null, initiativeId: 'split', phaseId });
  const team = [
    teamEntry(createTask({ id: 'own-build', stage: 'building' }), {
      instanceId: 'owner-machine',
      initiative: inIt(null),
    }),
    teamEntry(createTask({ id: 'own-next', stage: 'waiting_on_tasks' }), {
      instanceId: 'owner-machine',
      initiative: inIt('p1'),
    }),
    teamEntry(createTask({ id: 'own-review', stage: 'awaiting_review' }), {
      instanceId: 'owner-machine',
      initiative: inIt(null),
      gates: [createGate({ id: 'og', taskId: 'own-review', type: 'review' })],
    }),
    teamEntry(createTask({ id: 'own-merged', stage: 'merged', closedAt: NOW }), {
      instanceId: 'owner-machine',
      initiative: inIt(null),
    }),
    teamEntry(createTask({ id: 'own-dropped', stage: 'cancelled', closedAt: NOW }), {
      instanceId: 'owner-machine',
      initiative: inIt(null),
    }),
    teamEntry(createTask({ id: 'elsewhere', stage: 'building' }), { instanceId: 'owner-machine' }),
  ];

  it('lists your tasks in it and the ones the team sees, by where each stands and its phase', () => {
    expect(ids(listTeamInitiativeTaskSections(state, SPLIT, team))).toEqual([
      ['Changes to review', ['mine-review', 'own-review']],
      ['In progress', ['mine-build', 'own-build']],
      ['Session and transport', ['mine-next', 'own-next']],
      ['Done', ['mine-merged', 'own-merged']],
      ['Cancelled', ['mine-dropped', 'own-dropped']],
    ]);
  });

  it('shows waiting tasks under Waiting when the initiative has no phases', () => {
    const plain = teamInitiative({ phases: [] });
    expect(
      ids(listTeamInitiativeTaskSections(state, plain, team)).find(([title]) => title === 'Waiting')
    ).toEqual(['Waiting', ['mine-next', 'own-next']]);
  });
});
