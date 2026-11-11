import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TEAM_SCOPES,
  describeInitiativeDigest,
  describeMilestones,
  type InitiativeTeamMember,
  listInitiativeProgress,
  listInitiativeTeamMembers,
  listTeamTasks,
  resolveInitiativeSheet,
  resolveScopedRefusal,
  TEAM_SCOPE_MESSAGES,
  type TeamTask,
  toggleScope,
} from '../../src/index.ts';
import {
  createHarness,
  createInitiative,
  createTask,
  type Harness,
  planLead,
  readInstruction,
  registerRepo,
  verifySetup,
} from '../harness.ts';

const KAI = { id: 'u-kai', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const CONTEXT = { owner: 'octocat', ownerProfile: null, machine: 'Studio' };

const TEAM = { teamId: 'team-1', instanceId: 'machine-kai', name: 'Chat split' };

function teamRepo(harness: Harness) {
  const repoId = registerRepo(harness, 'paywall-next', 'Superwall');
  const projectId = harness.state.repos[repoId]?.projectId ?? '';
  harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-1' });
  return repoId;
}

function joinTeam(harness: Harness, taskId: string, phaseId: string | null = null, team = TEAM) {
  harness.send({ type: 'task.join_initiative', taskId, initiativeId: 'remote-1', phaseId, team });
}

function refusal(harness: Harness, command: Parameters<Harness['send']>[0]) {
  try {
    harness.send(command);
  } catch (error) {
    return { code: (error as { code?: string }).code, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

function triageLead(harness: Harness, taskId: string) {
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Lead the chat split',
    repoId: null,
    size: 'small',
    branch: `lead/${taskId}`,
    waitsOn: [],
  });
  if (harness.task(taskId).stage === 'triage') verifySetup(harness, taskId);
  if (harness.task(taskId).stage === 'planning') planLead(harness, taskId);
}

function sharedLead() {
  const harness = createHarness();
  teamRepo(harness);
  const { initiativeId, leadId } = createInitiative(harness, { phases: ['Dock'] });
  triageLead(harness, leadId);
  harness.send({
    type: 'agent.report_initiative',
    runId: harness.activeRun(leadId).id,
    narrative: 'Started.',
  });
  harness.send({ type: 'initiative.add_to_team', initiativeId, teamId: 'team-1' });
  const dock = harness.state.initiatives[initiativeId]?.phases[0]?.id ?? null;
  return { harness, initiativeId, leadId, dock };
}

function member(changes: Partial<InitiativeTeamMember> = {}): InitiativeTeamMember {
  return {
    teamId: 'team-1',
    instanceId: 'machine-kai',
    taskId: 'kai-1',
    handle: 'SW-7',
    title: 'Sign webhooks',
    owner: 'kai',
    stage: 'planning',
    phaseId: null,
    gate: null,
    closedAt: null,
    ...changes,
  };
}

function record(harness: Harness, initiativeId: string, members: InitiativeTeamMember[], teamId = 'team-1') {
  harness.send({ type: 'initiative.record_team_members', initiativeId, teamId, members });
}

function initiativeOf(harness: Harness, id: string) {
  const initiative = harness.state.initiatives[id];
  if (!initiative) throw new Error(`no initiative ${id}`);
  return initiative;
}

describe('joining a teammate’s initiative', () => {
  test('a team task joins it in a phase, moves phase and leaves, each recorded on the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { repoId: teamRepo(harness) });
    joinTeam(harness, taskId, null, { ...TEAM, name: '  Chat   split  ' });
    expect(harness.task(taskId).teamInitiative).toEqual({
      teamId: 'team-1',
      instanceId: 'machine-kai',
      initiativeId: 'remote-1',
      phaseId: null,
      name: 'Chat split',
    });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Added to the teammate’s initiative Chat split');
    joinTeam(harness, taskId, 'phase-2');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Moved to another phase');
    const before = harness.state.seq;
    joinTeam(harness, taskId, 'phase-2');
    expect(harness.state.seq).toBe(before);
    harness.send({ type: 'task.join_initiative', taskId, initiativeId: null, phaseId: null });
    expect(harness.task(taskId).teamInitiative).toBeNull();
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Removed from the teammate’s initiative Chat split'
    );
  });

  test('joining one takes the task out of its own initiative, and joining its own takes it out again', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { repoId: teamRepo(harness) });
    const { initiativeId } = createInitiative(harness);
    harness.send({ type: 'task.join_initiative', taskId, initiativeId, phaseId: null });
    joinTeam(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({
      initiativeId: null,
      teamInitiative: { initiativeId: 'remote-1' },
    });
    harness.send({ type: 'task.join_initiative', taskId, initiativeId, phaseId: null });
    expect(harness.task(taskId)).toMatchObject({ initiativeId, teamInitiative: null });
  });

  test('refuses a task the team does not see, a lead task and a blank name falls back', () => {
    const harness = createHarness();
    teamRepo(harness);
    const own = createTask(harness, { repoId: registerRepo(harness, 'shinsa', 'Personal') });
    expect(
      refusal(harness, {
        type: 'task.join_initiative',
        taskId: own,
        initiativeId: 'remote-1',
        phaseId: null,
        team: TEAM,
      })
    ).toMatchObject({ code: 'initiative_not_shared' });
    const { initiativeId, leadId } = createInitiative(harness);
    harness.send({ type: 'initiative.add_to_team', initiativeId, teamId: 'team-1' });
    expect(
      refusal(harness, {
        type: 'task.join_initiative',
        taskId: leadId,
        initiativeId: 'remote-1',
        phaseId: null,
        team: TEAM,
      })
    ).toMatchObject({ code: 'initiative_invalid' });
    const shared = createTask(harness, { repoId: Object.keys(harness.state.repos)[0] ?? '' });
    joinTeam(harness, shared, null, { ...TEAM, name: '   ' });
    expect(harness.task(shared).teamInitiative?.name).toBe('Untitled initiative');
  });

  test('an agent joining one is recorded as done for you, naming the teammate’s initiative', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { repoId: teamRepo(harness) });
    harness.send(
      { type: 'task.join_initiative', taskId, initiativeId: 'remote-1', phaseId: null, team: TEAM },
      { onBehalf: true, byTask: taskId }
    );
    expect(harness.state.onBehalfActions.at(-1)?.summary).toBe(
      'Added “Fix tab group scroll” to the teammate’s initiative “Chat split”'
    );
  });

  test('a task a member files joins too, unless it names an initiative of its own', () => {
    const harness = createHarness();
    const repoId = teamRepo(harness);
    const taskId = createTask(harness, { repoId });
    joinTeam(harness, taskId, 'phase-2');
    const file = (extra: { initiativeId?: string } = {}) => {
      const before = new Set(Object.keys(harness.state.tasks));
      harness.send({ type: 'task.create', request: 'Retry webhooks', repoId, forkOf: taskId, ...extra });
      return Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
    };
    const child = file();
    expect(harness.task(child).teamInitiative).toMatchObject({
      initiativeId: 'remote-1',
      phaseId: 'phase-2',
    });
    const { initiativeId } = createInitiative(harness);
    const named = file({ initiativeId });
    expect(harness.task(named)).toMatchObject({ initiativeId });
    expect(harness.task(named).teamInitiative).toBeUndefined();
    const plain = createTask(harness, { repoId });
    expect(harness.task(plain).teamInitiative).toBeUndefined();
  });

  test('a member stays out of adoption, and cannot be made an initiative while it is in one', () => {
    const harness = createHarness();
    const repoId = teamRepo(harness);
    const root = createTask(harness, { repoId });
    const before = new Set(Object.keys(harness.state.tasks));
    harness.send({ type: 'task.create', request: 'Sign webhooks', repoId, forkOf: root });
    const joined = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
    joinTeam(harness, joined);
    expect(refusal(harness, { type: 'initiative.adopt_task', taskId: joined })).toMatchObject({
      code: 'initiative_exists',
      message: 'This task is already in the teammate’s initiative Chat split. Take it out first.',
    });
    harness.send({ type: 'initiative.adopt_task', taskId: root });
    expect(harness.task(root).initiativeId).toBeTruthy();
    expect(harness.task(joined)).toMatchObject({ teamInitiative: { initiativeId: 'remote-1' } });
    expect(harness.task(joined).initiativeId).toBeUndefined();
  });

  test('a change for a task that is gone records nothing', () => {
    const harness = createHarness();
    harness.replay({ type: 'task.team_initiative_changed', taskId: 'gone', teamInitiative: null });
    const taskId = createTask(harness);
    const lines = harness.task(taskId).activity.length;
    harness.replay({ type: 'task.team_initiative_changed', taskId, teamInitiative: null });
    expect(harness.task(taskId).activity).toHaveLength(lines);
  });
});

describe('the team task list', () => {
  test('names the initiative a team task is in, its own when shared, a teammate’s when it is that team’s', () => {
    const harness = createHarness();
    const repoId = teamRepo(harness);
    const { initiativeId } = createInitiative(harness);
    const local = createTask(harness, { repoId, request: 'Local member' });
    harness.send({ type: 'task.join_initiative', taskId: local, initiativeId, phaseId: null });
    const remote = createTask(harness, { repoId, request: 'Remote member' });
    joinTeam(harness, remote, 'phase-2');
    const projectId = harness.state.repos[repoId]?.projectId ?? '';
    harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-2' });
    const other = createTask(harness, { repoId, request: 'Other team' });
    joinTeam(harness, other, null, { ...TEAM, teamId: 'team-2' });
    const byTitle = (tasks: TeamTask[], title: string) => tasks.find((entry) => entry.task.title === title);
    const before = listTeamTasks(harness.state, 'team-1', CONTEXT);
    expect(byTitle(before, 'Local member')?.initiative).toBeNull();
    harness.send({ type: 'initiative.add_to_team', initiativeId, teamId: 'team-1' });
    const listed = listTeamTasks(harness.state, 'team-1', CONTEXT);
    expect(byTitle(listed, 'Local member')?.initiative).toEqual({
      instanceId: null,
      initiativeId,
      phaseId: null,
    });
    expect(byTitle(listed, 'Remote member')?.initiative).toEqual({
      instanceId: 'machine-kai',
      initiativeId: 'remote-1',
      phaseId: 'phase-2',
    });
    expect(byTitle(listed, 'Other team')?.initiative).toBeNull();
  });

  test('turns a teammate’s feed into the members of a shared initiative', () => {
    const harness = createHarness();
    const repoId = teamRepo(harness);
    const joined = createTask(harness, { repoId, request: 'Sign webhooks' });
    harness.send({
      type: 'task.join_initiative',
      taskId: joined,
      initiativeId: 'lead-machine-init',
      phaseId: null,
      team: { ...TEAM, instanceId: 'machine-owner' },
    });
    const outside = createTask(harness, { repoId, request: 'Outside' });
    const tasks = listTeamTasks(harness.state, 'team-1', CONTEXT);
    const feed = { teamId: 'team-1', instanceId: 'machine-kai', tasks };
    const initiative = { id: 'lead-machine-init', teamIds: ['team-1'] };
    const members = listInitiativeTeamMembers(initiative, 'machine-owner', feed);
    expect(members).toEqual([
      {
        teamId: 'team-1',
        instanceId: 'machine-kai',
        taskId: joined,
        handle: harness.task(joined).handle ?? null,
        title: 'Sign webhooks',
        owner: 'octocat',
        stage: harness.task(joined).stage,
        phaseId: null,
        gate: null,
        closedAt: null,
      },
    ]);
    expect(members.map((entry) => entry.taskId)).not.toContain(outside);
    expect(listInitiativeTeamMembers(initiative, 'machine-else', feed)).toEqual([]);
    expect(listInitiativeTeamMembers({ id: initiative.id }, 'machine-owner', feed)).toEqual([]);
    const gated: TeamTask = {
      ...tasks[0]!,
      task: { ...tasks[0]!.task, handle: null, closedAt: undefined },
      gates: [{ ...({} as TeamTask['gates'][number]), status: 'open', title: 'Review the plan' }],
    };
    expect(
      listInitiativeTeamMembers(initiative, 'machine-owner', { ...feed, tasks: [gated] })[0]
    ).toMatchObject({ handle: null, gate: 'Review the plan', closedAt: null });
  });
});

describe('teammates’ members on the lead’s machine', () => {
  test('records them, queues each move as a milestone naming the teammate and wakes the lead', () => {
    const { harness, initiativeId } = sharedLead();
    const wakes = harness.effectsOf('initiative.wake').length;
    record(harness, initiativeId, [member()]);
    expect(initiativeOf(harness, initiativeId).teamMembers).toEqual([member()]);
    expect(initiativeOf(harness, initiativeId).milestones?.at(-1)).toMatchObject({
      taskId: 'kai-1',
      kind: 'joined',
      teammate: { instanceId: 'machine-kai', handle: 'SW-7', title: 'Sign webhooks', owner: 'kai' },
    });
    expect(harness.effectsOf('initiative.wake').length).toBe(wakes + 1);
    const moves: [Partial<InitiativeTeamMember>, string, string][] = [
      [{ stage: 'building' }, 'plan_approved', ''],
      [{ stage: 'building', gate: 'Review the work' }, 'gate_opened', 'Review the work'],
      [{ stage: 'merged', gate: null, closedAt: 9 }, 'merged', ''],
    ];
    for (const [changes, kind, text] of moves) {
      record(harness, initiativeId, [member(changes)]);
      expect(initiativeOf(harness, initiativeId).milestones?.at(-1)).toMatchObject({ kind, text });
    }
  });

  test('records nothing when nothing changed, and no milestone for a move that is no milestone', () => {
    const { harness, initiativeId } = sharedLead();
    record(harness, initiativeId, [member()]);
    const seq = harness.state.seq;
    record(harness, initiativeId, [member()]);
    expect(harness.state.seq).toBe(seq);
    const milestones = initiativeOf(harness, initiativeId).milestones?.length;
    record(harness, initiativeId, [member({ stage: 'triage', title: 'Renamed' })]);
    expect(initiativeOf(harness, initiativeId).milestones?.length).toBe(milestones);
    expect(initiativeOf(harness, initiativeId).teamMembers?.[0]?.title).toBe('Renamed');
  });

  test('keeps each team’s members apart, and drops another team’s members sent under this team', () => {
    const { harness, initiativeId } = sharedLead();
    harness.send({ type: 'initiative.add_to_team', initiativeId, teamId: 'team-2' });
    record(harness, initiativeId, [member(), member({ teamId: 'team-2', taskId: 'stray' })]);
    record(harness, initiativeId, [member({ teamId: 'team-2', taskId: 'lin-1' })], 'team-2');
    expect(initiativeOf(harness, initiativeId).teamMembers?.map((entry) => entry.taskId)).toEqual([
      'kai-1',
      'lin-1',
    ]);
    harness.send({ type: 'initiative.remove_from_team', initiativeId, teamId: 'team-1' });
    expect(initiativeOf(harness, initiativeId).teamMembers?.map((entry) => entry.taskId)).toEqual(['lin-1']);
    harness.send({ type: 'initiative.remove_from_team', initiativeId, teamId: 'team-2' });
    expect(initiativeOf(harness, initiativeId)).not.toHaveProperty('teamMembers');
  });

  test('ignores members for an initiative that is gone, not shared with the team or without a live lead', () => {
    const { harness, initiativeId, leadId } = sharedLead();
    record(harness, 'gone', [member()]);
    record(harness, initiativeId, [member({ teamId: 'team-9' })], 'team-9');
    expect(initiativeOf(harness, initiativeId)).not.toHaveProperty('teamMembers');
    harness.send({ type: 'task.complete', taskId: leadId });
    record(harness, initiativeId, [member()]);
    expect(harness.state.initiatives[initiativeId]?.teamMembers).toBeUndefined();
    harness.replay({
      type: 'initiative.team_members_recorded',
      initiativeId: 'gone',
      teamId: 'team-1',
      members: [],
    });
  });

  test('counts them in the sheet, its progress and the lead’s digest, each with its owner', () => {
    const { harness, initiativeId, dock } = sharedLead();
    record(harness, initiativeId, [
      member({ taskId: 'a', handle: 'SW-1', title: 'Plan it', stage: 'planning', phaseId: dock }),
      member({ taskId: 'b', handle: 'SW-2', title: 'Build it', stage: 'building', phaseId: 'gone-phase' }),
      member({
        taskId: 'c',
        handle: null,
        title: 'Gated',
        stage: 'building',
        gate: 'Review the work',
        owner: null,
      }),
      member({ taskId: 'd', handle: 'SW-4', title: 'Shipped', stage: 'merged', phaseId: dock }),
      member({ taskId: 'e', handle: 'SW-5', title: 'Dropped', stage: 'cancelled', phaseId: dock }),
      member({ taskId: 'f', handle: 'SW-6', title: 'Queued', stage: 'triage' }),
    ]);
    const sheet = resolveInitiativeSheet(harness.state, initiativeId, harness.state.seq);
    if (!sheet) throw new Error('no sheet');
    expect(sheet.teammates.map((row) => [row.member.taskId, row.section, row.phase?.name ?? null])).toEqual([
      ['a', 'now', 'Dock'],
      ['d', 'shipped', 'Dock'],
      ['e', 'dropped', 'Dock'],
      ['c', 'owner', null],
      ['b', 'now', null],
      ['f', 'next', null],
    ]);
    expect(sheet.progress).toEqual(
      listInitiativeProgress(harness.state, initiativeOf(harness, initiativeId))
    );
    expect(
      sheet.progress.map((entry) => [entry.phase?.name ?? null, entry.total, entry.shipped, entry.dropped])
    ).toEqual([
      ['Dock', 3, 1, 1],
      ['Wrap up', 0, 0, 0],
      [null, 3, 0, 0],
    ]);
    const digest = describeInitiativeDigest(sheet);
    expect(digest).toContain('Teammates’ tasks, on their own machines, with their own gates:');
    expect(digest).toContain('- SW-1 Plan it, @kai’s task, phase Dock: planning');
    expect(digest).toContain('- Gated, a teammate’s task: waits for its owner: Review the work');
  });

  test('names a teammate’s task in the milestones the lead reads', () => {
    const { harness } = sharedLead();
    const text = describeMilestones(harness.state, [
      {
        taskId: 'kai-1',
        kind: 'merged',
        text: '',
        at: 1,
        teammate: { instanceId: 'm', handle: 'SW-7', title: 'Sign webhooks', owner: 'kai' },
      },
    ]);
    expect(text).toBe('- SW-7 Sign webhooks, @kai’s task merged');
  });
});

describe('a teammate writing to the lead', () => {
  function sendAsTeammate(
    harness: Harness,
    leadId: string,
    fromTeammateTask: { handle: string | null; title: string } | null = null
  ) {
    harness.send(
      {
        type: 'task.message',
        taskId: leadId,
        text: 'SW-120 should wait for me.',
        ...(fromTeammateTask ? { fromTeammateTask } : {}),
      },
      { guest: { ...KAI, scope: { kind: 'team', teamId: 'team-1', scopes: DEFAULT_TEAM_SCOPES } } }
    );
    return readInstruction(harness.activeRun(leadId));
  }

  test('their agent’s message reaches the lead as that task’s agent, by its owner, never as the human', () => {
    const { harness, leadId } = sharedLead();
    const prompt = sendAsTeammate(harness, leadId, { handle: 'SW-7', title: 'Sign webhooks' });
    expect(prompt).toContain(
      'The agent of a teammate’s task wrote to you about the initiative “Chat split”.'
    );
    expect(prompt).toContain(
      'The agent of SW-7 Sign webhooks, Kai Lane (@kai)’s task on their machine, wrote, not the human: SW-120 should wait for me.'
    );
    expect(prompt).toContain("that task's gates stay with its owner");
    expect(prompt).not.toContain('The human wrote');
  });

  test('a message with no task named, and one a teammate writes themselves, say who sent them', () => {
    const { harness, leadId } = sharedLead();
    expect(sendAsTeammate(harness, leadId, { handle: null, title: 'Retry' })).toContain(
      'The agent of Retry, Kai Lane (@kai)’s task'
    );
    harness.send({ type: 'agent.report_initiative', runId: harness.activeRun(leadId).id, narrative: 'Ok.' });
    harness.send(
      { type: 'task.message', taskId: leadId, text: 'Hi' },
      {
        guest: { ...KAI, name: null, scope: { kind: 'team', teamId: 'team-1', scopes: DEFAULT_TEAM_SCOPES } },
      }
    );
    const prompt = readInstruction(harness.activeRun(leadId));
    expect(prompt).toContain('A teammate wrote to you about the initiative “Chat split”.');
    expect(prompt).toContain('@kai, a teammate, wrote, not the human: Hi');
  });

  test('a teammate may message a shared lead without the message scope, and no other task', () => {
    const { harness, leadId } = sharedLead();
    const shared = createTask(harness, { repoId: Object.keys(harness.state.repos)[0] ?? '' });
    const muted = {
      ...KAI,
      scope: {
        kind: 'team' as const,
        teamId: 'team-1',
        scopes: toggleScope(DEFAULT_TEAM_SCOPES, 'message', false),
      },
    };
    expect(
      resolveScopedRefusal(harness.state, muted, { type: 'task.message', taskId: leadId, text: 'Hi' })
    ).toBeNull();
    expect(
      resolveScopedRefusal(harness.state, muted, { type: 'task.message', taskId: shared, text: 'Hi' })
    ).toBe(TEAM_SCOPE_MESSAGES.message);
    expect(
      resolveScopedRefusal(harness.state, muted, {
        type: 'round.send',
        taskId: leadId,
        roundId: 'r',
      } as never)
    ).toBe(TEAM_SCOPE_MESSAGES.message);
  });
});
