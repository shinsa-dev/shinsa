import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  describeQueue,
  isRoundDelivering,
  listQueuedMessages,
  removeQueuedMessage,
  sendQueuedMessage,
  updateQueuedMessage,
} from '@/lib/tasks/message-queue.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRound } from '../../support/rounds.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

const queued = createTask({
  id: 't',
  rounds: [
    createRound({ number: 1, status: 'shipped' }),
    createRound({ number: 2, status: 'active' }),
    createRound({ number: 3, status: 'waiting', request: 'Add dark mode.' }),
    createRound({ number: 4, status: 'waiting', request: 'And a toggle.' }),
  ],
});

describe('the message queue', () => {
  it('lists the rounds that wait to start, in order, as the messages they were sent as', () => {
    expect(listQueuedMessages(queued)).toEqual([
      { number: 3, text: 'Add dark mode.' },
      { number: 4, text: 'And a toggle.' },
    ]);
    expect(listQueuedMessages(createTask({ id: 'plain' }))).toEqual([]);
  });

  it('says when the queue goes: after the round in progress, one at a time', () => {
    const one = createTask({ ...queued, rounds: queued.rounds?.slice(0, 3) ?? [] });
    expect(describeQueue(createShinsaState({ tasks: [one] }), one)).toBe('Sends once round 2 is finished.');
    expect(describeQueue(createShinsaState({ tasks: [queued] }), queued)).toBe(
      'Sends once round 2 is finished, one round at a time.'
    );
    const plain = createTask({ id: 'plain' });
    expect(describeQueue(createShinsaState({ tasks: [plain] }), plain)).toBe('');
  });

  it('names what you have to do first when the round in progress waits at your merge or your review', () => {
    const rounds = [
      createRound({ number: 1, status: 'active' }),
      createRound({ number: 2, status: 'waiting', pipeline: ['operate'] }),
    ];
    const change = [rounds[0], createRound({ number: 2, status: 'waiting' })].flatMap((round) =>
      round ? [round] : []
    );
    const at = (stage: 'awaiting_merge' | 'awaiting_review', type: 'merge' | 'review', of = rounds) => {
      const task = createTask({ id: 'g', stage, rounds: of });
      const state = createShinsaState({ tasks: [task], gates: [createGate({ id: 'x', taskId: 'g', type })] });
      return describeQueue(state, task);
    };
    expect(at('awaiting_merge', 'merge')).toBe('Sends after you merge round 1.');
    expect(at('awaiting_review', 'review')).toBe('Sends after you approve and merge round 1.');
    expect(at('awaiting_review', 'review', change)).toBe('Sends after you approve round 1.');
    expect(at('awaiting_merge', 'merge', change)).toBe('Sends once round 1 is finished.');
  });

  it('marks a later round delivering until one of its runs has started', () => {
    const [first, active] = queued.rounds ?? [];
    if (!first || !active) throw new Error('missing rounds');
    expect(isRoundDelivering(active, [])).toBe(true);
    expect(isRoundDelivering(active, [createRun({ id: 'r', taskId: 't', round: 2, status: 'queued' })])).toBe(
      true
    );
    expect(
      isRoundDelivering(active, [createRun({ id: 'r', taskId: 't', round: 2, status: 'running' })])
    ).toBe(false);
    expect(isRoundDelivering({ ...first, status: 'active' }, [])).toBe(false);
    expect(isRoundDelivering(first, [])).toBe(false);
  });
});

describe('changing a queued message', () => {
  let commands: ReturnType<typeof spyOnCommands>;
  beforeEach(() => {
    commands = spyOnCommands();
  });
  afterEach(() => {
    commands.restore();
  });

  it('sends the new text for the queued round, removes it or sends it to the current round now, and says so', async () => {
    const [message] = listQueuedMessages(queued);
    if (!message) throw new Error('missing message');
    expect(await updateQueuedMessage(queued, message, 'Add a light theme.')).toBe(true);
    expect(await removeQueuedMessage(queued, message)).toBe(true);
    expect(await sendQueuedMessage(queued, message)).toBe(true);
    expect(commands.sent.mock.calls).toEqual([
      [
        { type: 'round.update', taskId: 't', number: 3, request: 'Add a light theme.' },
        'Changed the queued message.',
      ],
      [{ type: 'round.remove', taskId: 't', number: 3 }, 'Removed the queued message.'],
      [{ type: 'round.send', taskId: 't', number: 3 }, 'Sent to round 2.'],
    ]);
  });
});
