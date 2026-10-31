import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  changeRoundShipping,
  describeRoundStatus,
  describeRoundTime,
  hasRounds,
  listEarlierRounds,
  listRoundSections,
  listShippingItems,
  listWaitingRounds,
  resolveHandleText,
  resolveRoundCount,
  resolveRoundDivider,
  resolveRoundFact,
  resolveRoundSummary,
  resolveRoundTag,
  selectRoundPullRequest,
  selectRoundRun,
} from '@/lib/tasks/rounds.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRound } from '../../support/rounds.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

const NO_STATE = createShinsaState({});

const NO_TASK = createTask({ id: 'none' });

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
        status: 'waiting',
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
    expect(resolveRoundTag(task)).toBe('Round 2');
    expect(resolveHandleText(task)).toBe('SW-14 · Round 2');
  });

  it('says how each round stands', () => {
    expect(describeRoundStatus(createRound({ number: 1, status: 'shipped' }))).toEqual({
      label: 'On its pull request',
      tone: 'green',
    });
    expect(describeRoundStatus(createRound({ number: 1, status: 'waiting' })).label).toBe('Waiting to start');
  });

  it('groups the runs of a task by round and lists the earlier and waiting ones', () => {
    const task = threeRounds();
    const runs = [createRun({ id: 'a', taskId: 't' }), createRun({ id: 'b', taskId: 't', round: 2 })];
    expect(
      listRoundSections(task, runs).map((section) => [
        section.round.number,
        section.runs.map((run) => run.id),
      ])
    ).toEqual([
      [1, ['a']],
      [2, ['b']],
      [3, []],
    ]);
    expect(listEarlierRounds(task).map((round) => round.number)).toEqual([1]);
    expect(listWaitingRounds(task).map((round) => round.number)).toEqual([3]);
  });

  it('takes the current round’s pull request from the task and an ended one’s from what it kept', () => {
    const task = threeRounds();
    const [first, second] = task.rounds ?? [];
    if (!first || !second) throw new Error('no rounds');
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

describe('a round, named and opened', () => {
  it('names the current round of all of them, with its title, how it stands and when it started', () => {
    expect(resolveRoundFact(createTask({ id: 'one' }))).toBeNull();
    expect(resolveRoundCount(createTask({ id: 'one' }))).toBeNull();
    const task = threeRounds();
    expect(resolveRoundCount(task)).toBe('Round 2 of 3');
    expect(resolveRoundFact(task, 10_000)).toEqual({
      label: 'Round 2 of 3',
      title: 'Round 2: Round 2 work',
      status: { label: 'In progress', tone: 'blue' },
      time: 'Started just now',
    });
    const resting = createTask({
      id: 'r',
      rounds: [
        createRound({ number: 1, status: 'finished' }),
        createRound({ number: 2, status: 'finished', endedAt: 0 }),
      ],
    });
    expect(resolveRoundFact(resting, 2 * 3_600_000)).toMatchObject({
      status: { label: 'Finished', tone: 'green' },
      time: 'Finished 2h ago',
    });
  });

  it('says in sentence case when a round started, finished, stopped or was added', () => {
    const hour = 3_600_000;
    expect(describeRoundTime(createRound({ number: 1, startedAt: 0, endedAt: null }), 3 * hour)).toBe(
      'Started 3h ago'
    );
    expect(describeRoundTime(createRound({ number: 1, endedAt: hour }), 3 * hour)).toBe('Finished 2h ago');
    expect(describeRoundTime(createRound({ number: 1, status: 'cancelled', endedAt: hour }), 3 * hour)).toBe(
      'Stopped 2h ago'
    );
    expect(
      describeRoundTime(createRound({ number: 2, status: 'waiting', startedAt: null, endedAt: null }), 1_000)
    ).toBe('Added just now');
  });

  it('names a round’s divider: the round, its title, how it stands and when it started or ended', () => {
    const hour = 3_600_000;
    expect(
      resolveRoundDivider(
        createRound({
          number: 2,
          title: 'Restructure the projects directory',
          status: 'finished',
          endedAt: hour,
        }),
        3 * hour
      )
    ).toEqual({
      label: 'Round 2',
      title: 'Restructure the projects directory',
      heading: 'Round 2: Restructure the projects directory',
      status: { label: 'Finished', tone: 'green' },
      time: 'Finished 2h ago',
    });
    expect(
      resolveRoundDivider(createRound({ number: 3, status: 'waiting', startedAt: null, endedAt: null }))
        .status.label
    ).toBe('Waiting to start');
  });

  it('finds the first step a round ran, never a delegated one', () => {
    const [first, second] = threeRounds().rounds ?? [];
    const runs = [
      createRun({ id: 'child', taskId: 't', startedAt: 1, delegation: DELEGATION }),
      createRun({ id: 'a', taskId: 't', startedAt: 2 }),
      createRun({ id: 'b', taskId: 't', startedAt: 3, round: 2 }),
    ];
    expect(first && selectRoundRun(runs, first)?.id).toBe('a');
    expect(second && selectRoundRun(runs, second)?.id).toBe('b');
    expect(second && selectRoundRun([], second)).toBeNull();
  });

  it('sums up an ended round: what it was about, what it did and where it shipped', () => {
    expect(resolveRoundSummary(NO_STATE, NO_TASK, createRound({ number: 1 }))).toBe(
      'Add MCP v2. Added MCP v2. Merged in pull request #12.'
    );
    expect(
      resolveRoundSummary(
        NO_STATE,
        NO_TASK,
        createRound({
          number: 1,
          status: 'shipped',
          pullRequest: { number: 14, url: 'u', state: 'open', base: 'main' },
          outcome: {
            goal: 'Add MCP v2',
            phases: ['Wire it', 'Test it'],
            headline: 'Add MCP v2.',
            result: null,
          },
        })
      )
    ).toBe('Add MCP v2. It finished 2 phases: wire it and test it. Shipped on pull request #14.');
    expect(
      resolveRoundSummary(
        NO_STATE,
        NO_TASK,
        createRound({
          number: 1,
          title: 'Round one',
          status: 'finished',
          outcome: { goal: null, phases: ['A', 'B', 'C', 'D'], headline: 'Round one', result: null },
        })
      )
    ).toBe('Round one. It finished 4 phases. Merged in pull request #12.');
  });

  it('sums up an inquiry round with the first sentence of its result, without markdown', () => {
    expect(
      resolveRoundSummary(
        NO_STATE,
        NO_TASK,
        createRound({
          number: 2,
          title: 'Why exports stall',
          status: 'finished',
          pullRequest: null,
          pipeline: ['investigate'],
          outcome: {
            goal: null,
            phases: [],
            headline: null,
            result: '\n\n## Diagnosis\n\n- The export **times out** after 30s. Then it retries\nforever.',
          },
        })
      )
    ).toBe('Why exports stall. The export **times out** after 30s.');
    expect(
      resolveRoundSummary(
        NO_STATE,
        NO_TASK,
        createRound({
          number: 2,
          title: 'Hi',
          status: 'finished',
          pullRequest: null,
          outcome: { goal: null, phases: [], headline: null, result: '  ' },
        })
      )
    ).toBe('Hi.');
  });

  it('says a stopped round stopped, and a round without an outcome only what it was about', () => {
    expect(
      resolveRoundSummary(NO_STATE, NO_TASK, createRound({ number: 3, status: 'cancelled', outcome: null }))
    ).toBe('Round 3 work. It stopped before it finished.');
    expect(
      resolveRoundSummary(
        NO_STATE,
        NO_TASK,
        createRound({
          number: 3,
          status: 'finished',
          pullRequest: { number: 9, url: 'u', state: 'merged', base: 'main' },
          outcome: null,
        })
      )
    ).toBe('Round 3 work. Merged in pull request #9.');
  });

  it('says why a waiting round was queued and when it starts', () => {
    expect(
      resolveRoundSummary(
        NO_STATE,
        NO_TASK,
        createRound({ number: 4, status: 'waiting', why: 'Cache the schemas' })
      )
    ).toBe('Cache the schemas. It starts once round 3 is finished.');
    expect(resolveRoundSummary(NO_STATE, NO_TASK, createRound({ number: 4, status: 'waiting' }))).toBe(
      'Round 4 work. It starts once round 3 is finished.'
    );
  });

  it('says when the next round waits for your merge or your review instead of finishing by itself', () => {
    const next = createRound({ number: 2, status: 'waiting', why: 'Try it', pipeline: ['operate'] });
    const later = createRound({ number: 3, status: 'waiting', pipeline: ['operate'] });
    const rounds = [createRound({ number: 1, status: 'active' }), next, later];
    const merging = createTask({ id: 't', stage: 'awaiting_merge', rounds });
    const atMerge = createShinsaState({
      tasks: [merging],
      gates: [createGate({ id: 'g', taskId: 't', type: 'merge' })],
    });
    expect(resolveRoundSummary(atMerge, merging, next)).toBe('Try it. It starts after you merge round 1.');
    expect(resolveRoundSummary(atMerge, merging, later)).toBe(
      'Round 3 work. It starts once round 2 is finished.'
    );
    const reviewing = createTask({ id: 't', stage: 'awaiting_review', rounds });
    const atReview = createShinsaState({
      tasks: [reviewing],
      gates: [createGate({ id: 'g', taskId: 't', type: 'review' })],
    });
    expect(resolveRoundSummary(atReview, reviewing, next)).toBe(
      'Try it. It starts after you approve and merge round 1.'
    );
  });
});

const DELEGATION = {
  parentRunId: 'a',
  depth: 1,
  requestKey: 'k',
  title: 'Survey',
  brief: 'Look.',
  mode: 'async' as const,
  wake: 'always' as const,
  isolation: 'shared' as const,
  baseCommit: null,
  delivery: 'none' as const,
  question: null,
  requestedAt: 0,
};
