import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  changeRoundShipping,
  describeRoundStatus,
  hasRounds,
  listEarlierRounds,
  listRoundSections,
  listShippingItems,
  listWaitingRounds,
  resolveHandleText,
  resolveRoundTag,
  resolveRoundTrack,
  selectRoundPullRequest,
} from '@/lib/tasks/rounds.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRound } from '../../support/rounds.ts';
import { createRun, createTask } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

const OPEN = {
  number: 12,
  url: 'https://github.com/o/r/pull/12',
  state: 'open' as const,
  checks: 'passing' as const,
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: 0,
};

function threeRounds() {
  return createTask({
    id: 't',
    handle: 'SW-14',
    stage: 'building',
    pullRequest: OPEN,
    rounds: [
      createRound({ number: 1, status: 'shipped', pullRequest: { ...OPEN, base: 'main' } }),
      createRound({ number: 2, status: 'active', pullRequest: { ...OPEN, base: 'main' }, outcome: null }),
      createRound({
        number: 3,
        status: 'queued',
        startedAt: null,
        endedAt: null,
        pullRequest: null,
        outcome: null,
      }),
    ],
  });
}

describe('rounds on screen', () => {
  it('names the round after the handle only once a task has more than one round', () => {
    const single = createTask({ id: 'a', handle: 'SW-1' });
    expect(hasRounds(single)).toBe(false);
    expect(resolveRoundTag(single)).toBeNull();
    expect(resolveHandleText(single)).toBe('SW-1');
    expect(resolveHandleText(createTask({ id: 'b' }))).toBeNull();
    const task = threeRounds();
    expect(resolveRoundTag(task)).toBe('round 2');
    expect(resolveHandleText(task)).toBe('SW-14 · round 2');
  });

  it('says how each round stands', () => {
    expect(describeRoundStatus(createRound({ number: 1, status: 'shipped' }))).toEqual({
      label: 'On its pull request',
      tone: 'green',
    });
    expect(describeRoundStatus(createRound({ number: 1, status: 'queued' })).label).toBe('Waiting to start');
  });

  it('groups the runs of a task by round, the current one marked, and lists the earlier and waiting ones', () => {
    const task = threeRounds();
    const runs = [createRun({ id: 'a', taskId: 't' }), createRun({ id: 'b', taskId: 't', round: 2 })];
    expect(
      listRoundSections(task, runs).map((section) => [
        section.round.number,
        section.runs.map((run) => run.id),
        section.current,
      ])
    ).toEqual([
      [1, ['a'], false],
      [2, ['b'], true],
      [3, [], false],
    ]);
    expect(listEarlierRounds(task).map((round) => round.number)).toEqual([1]);
    expect(listWaitingRounds(task).map((round) => round.number)).toEqual([3]);
  });

  it('draws the current round from the task and an ended one from what it kept', () => {
    const task = threeRounds();
    const [first, second] = task.rounds ?? [];
    if (!first || !second) throw new Error('no rounds');
    expect(resolveRoundTrack(task, second).phases.map((phase) => phase.title)).toContain('Plan');
    expect(
      resolveRoundTrack(task, first)
        .phases.map((phase) => phase.status)
        .at(-1)
    ).toBe('waiting');
    expect(selectRoundPullRequest(task, second)).toBe(OPEN);
    expect(selectRoundPullRequest(createTask({ id: 'x' }), second)?.number).toBe(12);
    expect(selectRoundPullRequest(task, first)?.state).toBe('open');
  });

  it('offers how a round ships only while it can still change and a pull request is open', () => {
    const task = threeRounds();
    const queued = task.rounds?.[2];
    if (!queued) throw new Error('no round');
    expect(listShippingItems(task, queued)).toEqual([
      { value: 'onto_pull_request', label: 'Onto #12' },
      { value: 'stacked', label: 'As a stacked pull request' },
    ]);
    expect(listShippingItems({ ...task, pullRequest: null }, queued)).toBeNull();
    expect(listShippingItems({ ...task, stage: 'shipping' }, task.rounds?.[1] ?? queued)).toBeNull();
  });

  it('changes how a round ships with a toast saying how', async () => {
    const task = threeRounds();
    const queued = task.rounds?.[2];
    if (!queued) throw new Error('no round');
    await changeRoundShipping(task, queued, 'stacked');
    await changeRoundShipping(task, queued, 'onto_pull_request');
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'round.ship', taskId: 't', number: 3, shipping: 'stacked' },
        'Round 3 ships as its own stacked pull request.',
      ],
      [
        { type: 'round.ship', taskId: 't', number: 3, shipping: 'onto_pull_request' },
        'Round 3 ships onto the open pull request.',
      ],
    ] as never);
  });
});
