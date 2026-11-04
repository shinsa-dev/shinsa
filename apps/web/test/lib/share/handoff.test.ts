import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { describeMentionText } from '@/lib/remote/users.ts';
import {
  canHandOff,
  closeHandoffRemoveConfirm,
  describeHandoffBanner,
  describeHandoffClaim,
  describeHandoffMark,
  describeHandToTeammate,
  HANDOFF_ICON,
  HANDOFF_LINK,
  handOffTask,
  handToTeammate,
  listHandoffTargetItems,
  listHandoffTeammates,
  isTaskHandedOff,
  openHandoffRemoveConfirm,
  removeHandoff,
  resolveHandoffFact,
  resolveHandoffView,
  useHandoffRemoveConfirm,
} from '@/lib/share/handoff.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createProject, createShinsaState, createTask } from '../../support/state.ts';
import * as teams from '../../support/teams.ts';

const KAI = { id: 'u2', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const HANDED = { at: 5, url: null, guest: null, claimedAt: null };

afterEach(() => {
  closeHandoffRemoveConfirm();
});

describe('handing a task off', () => {
  it('offers it on an open task and on one already handed off, never on a finished task or an automation', () => {
    expect(canHandOff(createTask({ id: 't1', stage: 'building' }))).toBe(true);
    expect(canHandOff(createTask({ id: 't1', stage: 'done' }))).toBe(false);
    expect(
      canHandOff(createTask({ id: 't1', stage: 'done', handoff: { ...HANDED, guest: KAI, claimedAt: 9 } }))
    ).toBe(true);
    expect(canHandOff(createTask({ id: 't1', stage: 'building', watchHome: true }))).toBe(false);
  });

  it('waits for the link, shows it, says why it failed and who took the task over', () => {
    expect(resolveHandoffView(createTask({ id: 't1' }))).toEqual({ kind: 'off' });
    expect(resolveHandoffView(createTask({ id: 't1', handoff: HANDED }))).toEqual({ kind: 'linking' });
    expect(resolveHandoffView(createTask({ id: 't1', handoff: { ...HANDED, url: 'https://x' } }))).toEqual({
      kind: 'ready',
      url: 'https://x',
    });
    expect(
      resolveHandoffView(createTask({ id: 't1', handoff: { ...HANDED, failure: 'Remote access is off.' } }))
    ).toEqual({
      kind: 'failed',
      message: 'Remote access is off.',
    });
    expect(
      resolveHandoffView(createTask({ id: 't1', handoff: { ...HANDED, guest: KAI, claimedAt: 9 } }))
    ).toEqual({
      kind: 'claimed',
      guest: KAI,
      at: 9,
    });
    expect(resolveHandoffView(createTask({ id: 't1', handoff: { ...HANDED, guest: KAI } }))).toMatchObject({
      at: 5,
    });
    expect(describeHandoffClaim(KAI)).toEqual([{ user: KAI }, ' is working on this task']);
    expect(describeMentionText(describeHandoffClaim(KAI))).toBe('Kai is working on this task');
    expect(describeMentionText(describeHandoffClaim({ ...KAI, name: null }))).toBe(
      'kai is working on this task'
    );
    expect(describeHandoffBanner({ kind: 'off' })).toBeNull();
    expect(describeHandoffBanner({ kind: 'linking' })).toEqual(['Making the hand-off link.']);
    expect(describeHandoffBanner({ kind: 'failed', message: 'Remote access is off.' })).toEqual([
      'The hand-off link couldn’t be made. Remote access is off.',
    ]);
    expect(describeHandoffBanner({ kind: 'ready', url: 'https://x' })?.[0]).toContain('first GitHub account');
    expect(describeHandoffBanner({ kind: 'claimed', guest: KAI, at: 9 })).toEqual([
      { user: KAI },
      ' is working on this task',
      '. It stays yours.',
    ]);
  });

  it('marks a task handed off or waiting on its link, and names who has it on each side', () => {
    const LEE = { id: 'u1', login: 'lee', name: 'Lee Park', avatarUrl: null };
    const claimed = createTask({ id: 't1', handoff: { ...HANDED, guest: KAI, claimedAt: 9 } });
    const ready = createTask({ id: 't1', handoff: { ...HANDED, url: 'https://x' } });
    expect(HANDOFF_ICON).toBe('IconHandshake');
    expect(isTaskHandedOff(createTask({ id: 't1' }))).toBe(false);
    expect(isTaskHandedOff(createTask({ id: 't1', handoff: HANDED }))).toBe(false);
    expect(
      isTaskHandedOff(createTask({ id: 't1', handoff: { ...HANDED, url: 'https://x', failure: 'No.' } }))
    ).toBe(false);
    expect(isTaskHandedOff(ready)).toBe(true);
    expect(isTaskHandedOff(claimed)).toBe(true);
    expect(describeHandoffMark(claimed, null)).toBe('Handed to Kai');
    expect(describeHandoffMark(ready, null)).toBe('Hand-off link not opened yet');
    expect(describeHandoffMark(claimed, { handedBy: LEE })).toBe('Handed to you by Lee');
    expect(resolveHandoffFact(ready, null)).toBeNull();
    expect(resolveHandoffFact(claimed, null)).toMatchObject({ verb: 'Handed to', user: KAI });
    expect(resolveHandoffFact(claimed, { handedBy: LEE })).toMatchObject({
      verb: 'Handed to you by',
      user: LEE,
    });
  });

  it('names a teammate task’s owner, and says when you took it over or a teammate holds it', () => {
    const MONA = { id: 'u5', login: 'mona', name: 'Mona Lisa', avatarUrl: null };
    const viewer = { teammate: { owner: MONA, viewerId: KAI.id } };
    const open = createTask({ id: 't1' });
    const taken = createTask({
      id: 't1',
      handoff: { ...HANDED, guest: KAI, claimedAt: 9, teamId: 'team-1' },
    });
    expect(resolveHandoffFact(open, viewer)).toMatchObject({
      verb: 'Owned by',
      user: MONA,
      icon: 'IconUser',
    });
    expect(resolveHandoffFact(taken, viewer)?.icon).toBeUndefined();
    expect(resolveHandoffFact(taken, viewer)).toMatchObject({ verb: 'Taken over from', user: MONA });
    expect(describeHandoffMark(taken, viewer)).toBe('You took this over from Mona');
    expect(describeHandoffMark(taken, { teammate: { owner: MONA, viewerId: 'u9' } })).toBe('Handed to Kai');
    expect(resolveHandoffFact(taken, null)).toMatchObject({
      verb: 'Handed to',
      user: KAI,
      hint: 'A teammate works on it from Shinsa Cloud',
    });
  });

  it('sends the hand-off and its removal, naming who loses the task', async () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't' });
    await handOffTask(task);
    await removeHandoff({ ...task, handoff: { ...HANDED, url: 'https://x' } });
    await removeHandoff({ ...task, handoff: { ...HANDED, guest: KAI, claimedAt: 9 } });
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.hand_off', taskId: 't' }],
      [{ type: 'handoff.remove', taskId: 't' }, 'The hand-off link is off.'],
      [{ type: 'handoff.remove', taskId: 't' }, 'Kai no longer has this task.'],
    ]);
    spies.restore();
  });

  it('opens and closes the removal confirmation for one task', () => {
    const { result } = renderHook(() => useHandoffRemoveConfirm());
    expect(result.current).toBeNull();
    act(() => openHandoffRemoveConfirm('t'));
    expect(result.current).toBe('t');
    act(() => closeHandoffRemoveConfirm());
    expect(result.current).toBeNull();
  });
});

describe('handing a task to a teammate', () => {
  const RIO = { id: '12', login: 'rio', name: 'Rio Diaz', avatarUrl: null };
  const state = createShinsaState({
    projects: [
      createProject({ id: 'shared', teamIds: ['team1', 'team2'] }),
      createProject({ id: 'private' }),
    ],
  });
  const remote = createRemoteSnapshot({
    access: { owner: teams.MONA, members: [] },
    teams: [
      teams.createTeamEntry(),
      teams.createTeamEntry({
        team: teams.createTeam({
          id: 'team2',
          owner: RIO,
          members: [
            { user: teams.KAI, addedAt: 1 },
            { user: teams.MONA, addedAt: 1 },
          ],
        }),
      }),
      teams.createTeamEntry({ id: 'team3', team: null }),
    ],
  });

  it('lists everyone else in the teams that see the task’s project, once each, by first name', () => {
    const task = createTask({ id: 't', projectId: 'shared' });
    const teammates = listHandoffTeammates(state, task, remote);
    expect(teammates.map((teammate) => [teammate.user.login, teammate.teamId])).toEqual([
      ['kai', 'team1'],
      ['rio', 'team2'],
    ]);
    expect(listHandoffTeammates(state, createTask({ id: 't', projectId: 'private' }), remote)).toEqual([]);
    expect(listHandoffTeammates(state, task, null)).toEqual([]);
    expect(listHandoffTargetItems(teammates)).toEqual([
      { value: HANDOFF_LINK, label: 'Anyone with the link' },
      { value: '7', label: 'Kai' },
      { value: '12', label: 'Rio' },
    ]);
    expect(describeHandToTeammate(RIO)).toBe('Hand to Rio');
  });

  it('sends the teammate with the team that sees the task', async () => {
    const spies = spyOnCommands();
    await handToTeammate(createTask({ id: 't' }), { teamId: 'team2', user: RIO });
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.hand_to_teammate', taskId: 't', teamId: 'team2', teammate: RIO }, 'Handed to Rio.'],
    ]);
  });
});
