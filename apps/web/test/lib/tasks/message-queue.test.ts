import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  describeQueue,
  isRoundDelivering,
  listQueuedMessages,
  removeQueuedMessage,
  updateQueuedMessage,
} from '@/lib/tasks/message-queue.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRound } from '../../support/rounds.ts';
import { createRun, createTask } from '../../support/state.ts';

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
    expect(describeQueue(queued, 1)).toBe('Sends once round 2 is finished.');
    expect(describeQueue(queued, 2)).toBe('Sends once round 2 is finished, one round at a time.');
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

  it('sends the new text for the queued round, or removes it, and says so', async () => {
    const [message] = listQueuedMessages(queued);
    if (!message) throw new Error('missing message');
    expect(await updateQueuedMessage(queued, message, 'Add a light theme.')).toBe(true);
    expect(await removeQueuedMessage(queued, message)).toBe(true);
    expect(commands.sent.mock.calls).toEqual([
      [
        { type: 'round.update', taskId: 't', number: 3, request: 'Add a light theme.' },
        'Changed the queued message.',
      ],
      [{ type: 'round.remove', taskId: 't', number: 3 }, 'Removed the queued message.'],
    ]);
  });
});
