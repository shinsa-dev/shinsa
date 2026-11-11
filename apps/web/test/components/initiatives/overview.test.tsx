import { describe, expect, it, spyOn } from 'bun:test';
import { resolveInitiativeSheet, resolveQueue, type ShinsaState, type TeamFeedSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { InitiativeOverview, TeamInitiativeOverview } from '@/components/initiatives/sheet.tsx';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { listQueueSections } from '@/lib/queue.ts';
import { createTeamFeedTask } from '../../lib/teams/machine.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createGate, createInitiative, createShinsaState, createTask, NOW } from '../../support/state.ts';
import { createTeamEntry } from '../../support/teams.ts';
import { addTeardown } from '../../support/teardown.ts';

function spyOnTeams(feed: TeamFeedSnapshot, state: ShinsaState | null = null) {
  const spies: { mockRestore: () => void }[] = [
    spyOn(connection, 'selectTeams').mockReturnValue(feed),
    spyOn(connection, 'selectRemote').mockReturnValue(
      createRemoteSnapshot({ teams: [createTeamEntry({ id: 'team1', name: 'Studio' })] })
    ),
  ];
  if (state) {
    const snapshot = connection.snapshot();
    spies.push(spyOn(connection, 'snapshot').mockReturnValue({ ...snapshot, state }));
  }
  addTeardown(() => {
    for (const spy of spies) spy.mockRestore();
  });
}

const KAI_TASK = createTask({ id: 'kai-1', handle: 'PL-3', title: 'Sign webhooks', stage: 'building' });

const LEAD = createTask({
  id: 'lead',
  handle: 'SW-130',
  title: 'Chat split',
  pipeline: ['lead'],
  stage: 'leading',
  initiativeId: 'split',
});

function createSplitState(report: { narrative: string } | null) {
  return createShinsaState({
    initiatives: [
      createInitiative({
        id: 'split',
        name: 'Chat split',
        leadTaskId: 'lead',
        phases: [
          { id: 'p1', name: 'Dock host' },
          { id: 'p2', name: 'Studio chat' },
        ],
        report: report ? { ...report, runId: 'r', at: NOW - 60_000 } : null,
      }),
    ],
    tasks: [
      LEAD,
      createTask({
        id: 'review',
        title: 'Rewrite the agent dock',
        stage: 'awaiting_review',
        initiativeId: 'split',
        initiativePhaseId: 'p1',
      }),
      createTask({
        id: 'later',
        title: 'Add the studio chat',
        stage: 'waiting_on_tasks',
        initiativeId: 'split',
        initiativePhaseId: 'p2',
      }),
      createTask({ id: 'loose', title: 'Tidy the docs', stage: 'waiting_on_tasks', initiativeId: 'split' }),
    ],
    gates: [createGate({ id: 'g', taskId: 'review', type: 'review' })],
  });
}

function renderOverview(state: ShinsaState) {
  const sheet = resolveInitiativeSheet(state, 'split', NOW);
  if (!sheet) throw new Error('no sheet');
  render(
    <TooltipProvider>
      <InitiativeOverview state={state} sheet={sheet} />
    </TooltipProvider>
  );
}

describe('the lead task’s overview', () => {
  it('shows where it stands and the tasks grouped as All tasks does, by phase', () => {
    renderOverview(createSplitState({ narrative: 'The dock is in review.' }));
    expect(screen.getByRole('heading', { name: /Where it stands/ })).toBeTruthy();
    expect(screen.getByText('The dock is in review.')).toBeTruthy();
    expect(screen.getByText('Rewrite the agent dock')).toBeTruthy();
    expect(screen.getAllByText('Changes to review').length).toBeGreaterThan(0);
    expect(screen.getByText('Studio chat')).toBeTruthy();
    expect(screen.getByText('No phase')).toBeTruthy();
  });

  it('leaves where it stands out before the lead’s first report', () => {
    renderOverview(createSplitState(null));
    expect(screen.queryByRole('heading', { name: /Where it stands/ })).toBeNull();
    expect(screen.getByText('Rewrite the agent dock')).toBeTruthy();
  });
});

describe('the lead task’s overview with teammates', () => {
  it('lists a teammate’s task beside yours, with the Repository and Owner columns', () => {
    spyOnTeams({
      machines: [],
      tasks: [createTeamFeedTask({ task: KAI_TASK, instanceId: 'kai-machine', owner: 'kai' })],
    });
    const base = createSplitState(null);
    const state = {
      ...base,
      initiatives: {
        split: {
          ...base.initiatives.split!,
          teamIds: ['team1'],
          teamMembers: [
            {
              teamId: 'team1',
              instanceId: 'kai-machine',
              taskId: 'kai-1',
              handle: 'PL-3',
              title: 'Sign webhooks',
              owner: 'kai',
              stage: 'building' as const,
              phaseId: null,
              gate: null,
              closedAt: null,
            },
          ],
        },
      },
    };
    renderOverview(state);
    expect(screen.getByText('Sign webhooks')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Repository')).toBeTruthy();
  });

  it('keeps the plain columns while every task is yours', () => {
    spyOnTeams({ machines: [], tasks: [] });
    renderOverview(createSplitState(null));
    expect(screen.queryByText('Owner')).toBeNull();
  });
});

describe('a teammate’s initiative, read-only', () => {
  const initiative = {
    id: 'kai-split',
    name: 'Kai’s split',
    description: '',
    phases: [],
    leadTaskId: 'kai-lead',
    report: { narrative: 'Webhooks first.', at: NOW },
    finished: false,
    updatedAt: NOW,
    teamId: 'team1',
    instanceId: 'kai-machine',
  };

  it('shows the lead’s report and the tasks the team sees in it, your own among them', () => {
    const mine = createTask({
      id: 'mine',
      title: 'Retry failed calls',
      stage: 'building',
      teamInitiative: {
        teamId: 'team1',
        instanceId: 'kai-machine',
        initiativeId: 'kai-split',
        phaseId: null,
        name: 'Kai’s split',
      },
    });
    spyOnTeams(
      {
        machines: [],
        tasks: [
          createTeamFeedTask({
            task: KAI_TASK,
            instanceId: 'kai-machine',
            initiative: { instanceId: null, initiativeId: 'kai-split', phaseId: null },
          }),
        ],
        initiatives: [initiative],
      },
      createShinsaState({ tasks: [mine] })
    );
    render(
      <TooltipProvider>
        <TeamInitiativeOverview initiative={initiative} />
      </TooltipProvider>
    );
    expect(screen.getByText('Webhooks first.')).toBeTruthy();
    expect(screen.getByText('Sign webhooks')).toBeTruthy();
    expect(screen.getByText('Retry failed calls')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('shows only the report before this page has a state', () => {
    spyOnTeams({ machines: [], tasks: [], initiatives: [initiative] });
    render(
      <TooltipProvider>
        <TeamInitiativeOverview initiative={initiative} />
      </TooltipProvider>
    );
    expect(screen.getByText('Webhooks first.')).toBeTruthy();
    expect(screen.queryByText('Owner')).toBeNull();
  });
});

describe('Home with an initiative', () => {
  it('lists its member tasks and never its lead', () => {
    const state = createSplitState({ narrative: 'Going.' });
    render(
      <TooltipProvider>
        <TaskQueue
          state={state}
          variant='wide'
          sections={listQueueSections(state, resolveQueue(state, NOW))}
        />
      </TooltipProvider>
    );
    expect(screen.getByText('Rewrite the agent dock')).toBeTruthy();
    expect(screen.queryByText('Chat split')).toBeNull();
  });
});
