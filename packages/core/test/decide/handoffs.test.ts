import { describe, expect, test } from 'bun:test';
import { DEFAULT_TEAM_SCOPES, serializeTaskDetail, type TaskGuest, toggleScope } from '../../src/index.ts';
import {
  parseCommand,
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  registerRepo,
} from '../harness.ts';

const URL = 'https://app.shinsa.dev/claim#inst.key.secret.invite';

const KAI: TaskGuest = { id: 'u-kai', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const ROBIN: TaskGuest = { id: 'u-robin', login: 'robin', name: null, avatarUrl: null };

function links(harness: Harness, taskId: string) {
  return harness.effectsOf('handoff.link').filter((effect) => effect.taskId === taskId).length;
}

function handOff(harness: Harness) {
  const taskId = createTask(harness);
  harness.send({ type: 'task.hand_off', taskId });
  harness.send({ type: 'handoff.record', taskId, url: URL });
  return taskId;
}

describe('handing a task off', () => {
  test('asks for a link once and records it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.hand_off', taskId });
    expect(harness.task(taskId).handoff).toEqual({
      at: harness.now,
      url: null,
      guest: null,
      claimedAt: null,
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'you',
      text: 'Made a link to hand this task off',
    });
    expect(harness.send({ type: 'task.hand_off', taskId }).events).toEqual([]);
    expect(links(harness, taskId)).toBe(1);
    harness.send({ type: 'handoff.record', taskId, url: URL });
    expect(harness.task(taskId).handoff?.url).toBe(URL);
    expect(harness.send({ type: 'handoff.record', taskId, url: URL }).events).toEqual([]);
  });

  test('a failed link is asked for again, and a link made later clears the failure', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.hand_off', taskId });
    harness.send({ type: 'handoff.fail', taskId, detail: 'Remote access is off.' });
    expect(harness.task(taskId).handoff?.failure).toBe('Remote access is off.');
    expect(harness.send({ type: 'handoff.fail', taskId, detail: 'Remote access is off.' }).events).toEqual(
      []
    );
    harness.send({ type: 'task.hand_off', taskId });
    expect(links(harness, taskId)).toBe(2);
    harness.send({ type: 'handoff.record', taskId, url: URL });
    expect(harness.task(taskId).handoff).toMatchObject({ url: URL, failure: null });
  });

  test('records and failures for a task that is not handed off change nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(harness.send({ type: 'handoff.record', taskId, url: URL }).events).toEqual([]);
    expect(harness.send({ type: 'handoff.fail', taskId, detail: 'No.' }).events).toEqual([]);
    expect(harness.send({ type: 'handoff.record', taskId: 'missing', url: URL }).events).toEqual([]);
    expect(harness.send({ type: 'handoff.remove', taskId }).events).toEqual([]);
  });

  test('the first account to claim the link takes the task, and nobody after it', () => {
    const harness = createHarness();
    const taskId = handOff(harness);
    harness.send({ type: 'handoff.claim', taskId, guest: KAI });
    expect(harness.task(taskId).handoff).toEqual({
      at: expect.any(Number),
      url: null,
      failure: null,
      guest: KAI,
      claimedAt: harness.now,
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Handed this task to Kai',
      person: { login: 'kai', name: 'Kai Lane', avatarUrl: null },
    });
    expect(harness.send({ type: 'handoff.claim', taskId, guest: KAI }).events).toEqual([]);
    expect(() => harness.send({ type: 'handoff.claim', taskId, guest: ROBIN })).toThrow(
      'Someone else already opened this hand-off link. Ask the task’s owner for a new one.'
    );
    expect(harness.send({ type: 'handoff.record', taskId, url: URL }).events).toEqual([]);
    expect(harness.send({ type: 'handoff.fail', taskId, detail: 'Late.' }).events).toEqual([]);
    expect(harness.send({ type: 'task.hand_off', taskId }).events).toEqual([]);
    expect(links(harness, taskId)).toBe(1);
  });

  test('a link that no longer hands off a task cannot be claimed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() => harness.send({ type: 'handoff.claim', taskId, guest: KAI })).toThrow(
      'This link no longer hands off a task. Ask for a new one.'
    );
  });

  test('removing it ends the link or takes the task back, and revokes the guest', () => {
    const harness = createHarness();
    const unclaimed = handOff(harness);
    const decision = harness.send({ type: 'handoff.remove', taskId: unclaimed });
    expect(decision.cancellations).toEqual([
      { taskId: unclaimed, kinds: ['handoff.link'], reason: 'The task is no longer handed off.' },
    ]);
    expect(harness.lastEffect('handoff.revoke')).toEqual({
      kind: 'handoff.revoke',
      taskId: unclaimed,
      guestId: null,
    });
    expect(harness.task(unclaimed).handoff).toBeNull();
    expect(harness.task(unclaimed).activity.at(-1)?.text).toBe('Turned off the link to hand this task off');
    const claimed = handOff(harness);
    harness.send({ type: 'handoff.claim', taskId: claimed, guest: KAI });
    harness.send({ type: 'handoff.remove', taskId: claimed });
    expect(harness.lastEffect('handoff.revoke')).toEqual({
      kind: 'handoff.revoke',
      taskId: claimed,
      guestId: 'u-kai',
    });
    expect(harness.task(claimed).activity.at(-1)).toMatchObject({
      text: 'Took this task back from Kai',
      person: { login: 'kai', name: 'Kai Lane', avatarUrl: null },
    });
  });

  test('a guest who leaves gives the task back, and someone else leaving changes nothing', () => {
    const harness = createHarness();
    const taskId = handOff(harness);
    expect(harness.send({ type: 'handoff.leave', taskId, guestId: 'u-kai' }).events).toEqual([]);
    harness.send({ type: 'handoff.claim', taskId, guest: KAI });
    expect(harness.send({ type: 'handoff.leave', taskId, guestId: 'u-robin' }).events).toEqual([]);
    harness.send({ type: 'handoff.leave', taskId, guestId: 'u-kai' });
    expect(harness.task(taskId).handoff).toBeNull();
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Kai gave this task back',
      person: { login: 'kai', name: 'Kai Lane', avatarUrl: null },
    });
    expect(harness.lastEffect('handoff.revoke')).toEqual({
      kind: 'handoff.revoke',
      taskId,
      guestId: 'u-kai',
    });
    harness.send({ type: 'task.hand_off', taskId });
    expect(harness.task(taskId).handoff?.guest).toBeNull();
  });

  test('is the human’s alone', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const refusal =
      'Only the human hands a task to someone else. Tell them they can hand it off from the task in Shinsa.';
    expect(() => harness.send({ type: 'task.hand_off', taskId }, { onBehalf: true })).toThrow(refusal);
    harness.send({ type: 'task.hand_off', taskId });
    expect(() => harness.send({ type: 'handoff.remove', taskId }, { onBehalf: true })).toThrow(refusal);
  });

  test('refuses an automation and a finished task', () => {
    const harness = createHarness();
    harness.replay({
      type: 'task.created',
      taskId: 'home',
      request: 'Watch',
      repoId: null,
      priority: 'normal',
      planFirst: false,
      origin: null,
      auto: { shape: false, start: false, priority: false },
      watchHome: true,
    });
    expect(() => harness.send({ type: 'task.hand_off', taskId: 'home' })).toThrow(
      'An automation cannot be handed off.'
    );
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    expect(() => harness.send({ type: 'task.hand_off', taskId })).toThrow(
      'This task is finished, so there is nothing left to hand off.'
    );
  });

  test('parses both commands from the page', () => {
    expect(parseCommand({ type: 'task.hand_off', taskId: 't1' })).toEqual({
      type: 'task.hand_off',
      taskId: 't1',
    });
    expect(parseCommand({ type: 'handoff.remove', taskId: 't1', extra: true })).toEqual({
      type: 'handoff.remove',
      taskId: 't1',
    });
  });
});

describe('working as the guest', () => {
  const asGuest = (taskId: string, person: TaskGuest = KAI) => ({
    guest: { ...person, scope: { kind: 'task' as const, taskId } },
  });

  test('stamps their login on what they do and tells the agent who wrote the message', () => {
    const harness = createHarness();
    const taskId = handOff(harness);
    harness.send({ type: 'handoff.claim', taskId, guest: KAI });
    const decision = harness.send(
      { type: 'task.message', taskId, text: 'Use the new tab API.' },
      asGuest(taskId)
    );
    expect(decision.events.every((event) => event.byGuest === 'kai')).toBe(true);
    const message = harness.task(taskId).activity.find((entry) => entry.detail === 'Use the new tab API.');
    expect(message).toMatchObject({ actor: 'you', byGuest: 'kai' });
    expect(message?.onBehalf).toBeUndefined();
    expect(
      JSON.stringify(harness.effectsOf('run.steer').at(-1) ?? harness.effectsOf('run.execute').at(-1))
    ).toContain('From Kai, who the human handed this task to:');
    expect(JSON.stringify(harness.task(taskId))).not.toContain('handed this task to');
    expect(serializeTaskDetail(harness.state, taskId)).toContain(' Kai: ');
    expect(serializeTaskDetail(harness.state, taskId)).not.toContain('@kai');
    harness.send({ type: 'handoff.remove', taskId });
    expect(serializeTaskDetail(harness.state, taskId)).toContain(' Kai: ');
  });

  test('names a guest with no name on GitHub by their login', () => {
    const harness = createHarness();
    const taskId = handOff(harness);
    harness.send({ type: 'handoff.claim', taskId, guest: ROBIN });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Handed this task to robin');
    harness.send({ type: 'task.message', taskId, text: 'On it.' }, asGuest(taskId, ROBIN));
    expect(
      JSON.stringify(harness.effectsOf('run.steer').at(-1) ?? harness.effectsOf('run.execute').at(-1))
    ).toContain('From robin, who the human handed this task to:');
  });

  test('answers a plan gate of their task as the human would', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { planFirst: true });
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    harness.send(
      { type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null },
      asGuest(taskId)
    );
    expect(harness.state.gates[gate.id]?.status).toBe('answered');
    expect(harness.task(taskId).activity.some((entry) => entry.byGuest === 'kai')).toBe(true);
  });

  test('is refused another task, a command outside the task and anything that is not theirs to send', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const other = createTask(harness, { request: 'Another' });
    const as = asGuest(taskId);
    expect(() => harness.send({ type: 'task.message', taskId: other, text: 'Hi' }, as)).toThrow(
      'You can only work on the task that was handed to you.'
    );
    expect(() => harness.send({ type: 'task.hand_off', taskId }, as)).toThrow(
      'This stays with the owner of the task. You were handed one task to work on.'
    );
    expect(() => harness.send({ type: 'settings.change', patch: { maxFixRounds: 2 } }, as)).toThrow(
      'This stays with the owner of the task.'
    );
    expect(() => harness.send({ type: 'handoff.claim', taskId, guest: KAI }, as)).toThrow(
      'This stays with the owner of the task.'
    );
  });
});

function teamTask(harness: Harness) {
  const repoId = registerRepo(harness);
  const projectId = harness.state.repos[repoId]?.projectId ?? '';
  harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-1' });
  return createTask(harness, { repoId });
}

function asTeammate(person: TaskGuest = KAI, message = false) {
  const scopes = toggleScope(DEFAULT_TEAM_SCOPES, 'message', message);
  return { guest: { ...person, scope: { kind: 'team' as const, teamId: 'team-1', scopes } } };
}

function lastPrompt(harness: Harness) {
  return JSON.stringify(harness.effectsOf('run.steer').at(-1) ?? harness.effectsOf('run.execute').at(-1));
}

describe('handing a task to a teammate', () => {
  test('gives it to them at once, with no link, and the owner takes it back without revoking anything', () => {
    const harness = createHarness();
    const taskId = teamTask(harness);
    harness.send({ type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: KAI });
    expect(harness.task(taskId).handoff).toEqual({
      at: harness.now,
      url: null,
      guest: KAI,
      claimedAt: harness.now,
      teamId: 'team-1',
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'you',
      text: 'Handed this task to Kai',
      person: { login: 'kai', name: 'Kai Lane', avatarUrl: null },
    });
    expect(harness.effectsOf('handoff.link')).toEqual([]);
    expect(
      harness.send({ type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: KAI }).events
    ).toEqual([]);
    const decision = harness.send({ type: 'handoff.remove', taskId });
    expect(decision.effects.filter((effect) => effect.kind === 'handoff.revoke')).toEqual([]);
    expect(harness.task(taskId).handoff).toBeNull();
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Took this task back from Kai');
  });

  test('turns off a link that nobody opened yet', () => {
    const harness = createHarness();
    const taskId = teamTask(harness);
    harness.send({ type: 'task.hand_off', taskId });
    const decision = harness.send({ type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: KAI });
    expect(decision.cancellations).toEqual([
      { taskId, kinds: ['handoff.link'], reason: 'The task went to a teammate instead.' },
    ]);
    expect(harness.lastEffect('handoff.revoke')).toEqual({ kind: 'handoff.revoke', taskId, guestId: null });
    expect(harness.task(taskId).handoff?.guest).toEqual(KAI);
  });

  test('is refused for a task outside the team, one someone else holds, a finished one and an agent', () => {
    const harness = createHarness();
    const outside = createTask(harness, { repoId: registerRepo(harness, 'shinsa', 'Personal') });
    expect(() =>
      harness.send({ type: 'task.hand_to_teammate', taskId: outside, teamId: 'team-1', teammate: KAI })
    ).toThrow('This task is not in a project that team sees, so no one in it can take it.');
    const taskId = teamTask(harness);
    harness.send({ type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: KAI });
    expect(() =>
      harness.send({ type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: ROBIN })
    ).toThrow('Kai has this task. Its owner takes it back first.');
    const finished = teamTask(harness);
    harness.send({ type: 'task.cancel', taskId: finished });
    expect(() =>
      harness.send({ type: 'task.hand_to_teammate', taskId: finished, teamId: 'team-1', teammate: KAI })
    ).toThrow('This task is finished, so there is nothing left to hand off.');
    expect(() =>
      harness.send(
        { type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: ROBIN },
        { onBehalf: true }
      )
    ).toThrow('Only the human hands a task to someone else.');
  });
});

describe('a task handed to a teammate', () => {
  test('is the owner’s to give: a teammate cannot give back a task they do not hold', () => {
    const harness = createHarness();
    const taskId = teamTask(harness);
    const refusal = 'Only the teammate who holds this task can give it back.';
    expect(() => harness.send({ type: 'task.give_back', taskId })).toThrow(refusal);
    expect(harness.send({ type: 'task.give_back', taskId }, asTeammate()).events).toEqual([]);
  });

  test('its holder messages its agent as its holder, and others as a teammate', () => {
    const harness = createHarness();
    const taskId = teamTask(harness);
    harness.send({ type: 'task.message', taskId, text: 'Look at the tabs.' }, asTeammate(ROBIN, true));
    expect(lastPrompt(harness)).toContain('From robin, a teammate of the human:');
    harness.send({ type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: KAI });
    harness.send({ type: 'task.message', taskId, text: 'Use the new tab API.' }, asTeammate());
    expect(lastPrompt(harness)).toContain('From Kai, who the human handed this task to:');
  });

  test('the holder gives it back, and nobody else can', () => {
    const harness = createHarness();
    const taskId = teamTask(harness);
    harness.send({ type: 'task.hand_to_teammate', taskId, teamId: 'team-1', teammate: KAI });
    expect(harness.send({ type: 'task.give_back', taskId }, asTeammate(ROBIN)).events).toEqual([]);
    const decision = harness.send({ type: 'task.give_back', taskId }, asTeammate());
    expect(decision.effects.filter((effect) => effect.kind === 'handoff.revoke')).toEqual([]);
    expect(harness.task(taskId).handoff).toBeNull();
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Kai gave this task back');
    expect(harness.send({ type: 'task.give_back', taskId }, asTeammate()).events).toEqual([]);
  });
});
