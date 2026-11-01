import { describe, expect, test } from 'bun:test';
import { DAY_MS, HOUR_MS, MINUTE_MS, parseUserCommand } from '../../src/index.ts';
import { createHarness, createTask, type Harness, proposePlan } from '../harness.ts';

const URL = 'https://app.shinsa.dev/share/inst/AAAAAAAAAAAAAAAAAAAAAA#key';

function links(harness: Harness, taskId: string) {
  return harness.effectsOf('share.link').filter((effect) => effect.taskId === taskId).length;
}

describe('sharing a task', () => {
  test('asks for a link once and records it in the activity', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    expect(harness.task(taskId).share).toEqual({
      at: harness.now,
      url: null,
      limit: 'until_done',
      preset: 'default',
      endsAt: null,
    });
    expect(links(harness, taskId)).toBe(1);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'you',
      text: 'Shared this task by link',
    });
    expect(harness.send({ type: 'task.share', taskId }).events).toEqual([]);
    expect(links(harness, taskId)).toBe(1);
  });

  test('a change to the task asks for nothing, since open links read it live', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    proposePlan(harness, taskId);
    expect(links(harness, taskId)).toBe(1);
  });

  test('an automation has nothing to share', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
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
    expect(() => harness.send({ type: 'task.share', taskId: 'home' })).toThrow(
      'An automation has nothing to share.'
    );
    expect(harness.task(taskId).share).toBeUndefined();
  });

  test('only the human shares or stops sharing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const refusal = 'Only the human decides what is shared outside this machine.';
    expect(() => harness.send({ type: 'task.share', taskId }, { onBehalf: true })).toThrow(refusal);
    harness.send({ type: 'task.share', taskId });
    expect(() => harness.send({ type: 'task.unshare', taskId }, { onBehalf: true })).toThrow(refusal);
  });

  test('both commands are parsed from the page', () => {
    expect(parseUserCommand({ type: 'task.share', taskId: 't1' })).toEqual({
      type: 'task.share',
      taskId: 't1',
    });
    expect(parseUserCommand({ type: 'task.share', taskId: 't1', limit: 'day' })).toEqual({
      type: 'task.share',
      taskId: 't1',
      limit: 'day',
    });
    expect(() => parseUserCommand({ type: 'task.share', taskId: 't1', limit: 'forever' })).toThrow();
    expect(parseUserCommand({ type: 'task.unshare', taskId: 't1' })).toEqual({
      type: 'task.unshare',
      taskId: 't1',
    });
  });
});

describe('the link', () => {
  test('is recorded once, and not after sharing stopped', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    harness.send({ type: 'share.record', taskId, url: URL });
    expect(harness.task(taskId).share?.url).toBe(URL);
    expect(harness.send({ type: 'share.record', taskId, url: URL }).events).toEqual([]);
    harness.send({ type: 'task.unshare', taskId });
    expect(harness.send({ type: 'share.record', taskId, url: URL }).events).toEqual([]);
    expect(harness.send({ type: 'share.record', taskId: 'missing', url: URL }).events).toEqual([]);
    expect(harness.task(taskId).share).toBeNull();
  });
});

describe('a link that could not be made', () => {
  test('is kept on the task until a link is recorded, and sharing again asks once more', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    const detail = 'Turn on remote access in Settings to share this task.';
    harness.send({ type: 'share.fail', taskId, detail });
    expect(harness.task(taskId).share?.failure).toBe(detail);
    expect(harness.send({ type: 'share.fail', taskId, detail }).events).toEqual([]);
    harness.send({ type: 'task.share', taskId });
    expect(links(harness, taskId)).toBe(2);
    harness.send({ type: 'share.record', taskId, url: null });
    expect(harness.task(taskId).share).toMatchObject({ url: null, failure: null });
    expect(harness.send({ type: 'share.record', taskId, url: null }).events).toEqual([]);
  });

  test('a record that keeps the link only clears the failure', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    harness.send({ type: 'share.record', taskId, url: URL });
    harness.send({ type: 'share.fail', taskId, detail: 'Remote access was removed.' });
    harness.send({ type: 'share.record', taskId, url: null });
    expect(harness.task(taskId).share?.url).toBe(URL);
    expect(harness.task(taskId).share?.failure).toBeNull();
  });

  test('is ignored once the task is no longer shared', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(harness.send({ type: 'share.fail', taskId, detail: 'Gone.' }).events).toEqual([]);
  });
});

describe('stopping sharing', () => {
  test('drops a link still being made and records it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    const decision = harness.send({ type: 'task.unshare', taskId });
    expect(decision.cancellations).toEqual([
      { taskId, kinds: ['share.link'], reason: 'The task is no longer shared.' },
    ]);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({ text: 'Stopped sharing this task' });
    expect(harness.send({ type: 'task.unshare', taskId }).events).toEqual([]);
  });
});

describe('how long a task is shared', () => {
  test('by default until the task finishes, then sharing stops by itself', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    harness.send({ type: 'share.record', taskId, url: URL });
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.task(taskId).share).toBeNull();
    expect(
      harness
        .task(taskId)
        .activity.some((entry) => entry.text === 'Stopped sharing this task, since it finished')
    ).toBe(true);
  });

  test('the setting picks the default, and a task can pick its own', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'settings.change', patch: { shareLimit: 'hour' } });
    harness.send({ type: 'task.share', taskId });
    expect(harness.task(taskId).share).toMatchObject({ limit: 'hour', endsAt: harness.now + HOUR_MS });
    harness.send({ type: 'share.record', taskId, url: URL });
    harness.send({ type: 'task.share', taskId, limit: 'day' });
    expect(harness.task(taskId).share).toMatchObject({
      url: URL,
      limit: 'day',
      endsAt: harness.now + DAY_MS,
    });
    expect(links(harness, taskId)).toBe(1);
    expect(
      harness.task(taskId).activity.filter((entry) => entry.text === 'Shared this task by link')
    ).toHaveLength(1);
    harness.send({ type: 'task.share', taskId, limit: 'none' });
    expect(harness.task(taskId).share).toMatchObject({ limit: 'none', endsAt: null });
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.task(taskId).share?.url).toBe(URL);
  });

  test('a time limit ends sharing once it has passed, and not before', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId, limit: 'hour' });
    expect(harness.send({ type: 'share.expire', taskId }).events).toEqual([]);
    harness.advance(HOUR_MS);
    harness.send({ type: 'share.expire', taskId });
    expect(harness.task(taskId).share).toBeNull();
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Stopped sharing this task, since its time ran out',
    });
    expect(harness.send({ type: 'share.expire', taskId }).events).toEqual([]);
    expect(harness.send({ type: 'share.expire', taskId: 'missing' }).events).toEqual([]);
  });

  test('sharing again after the time ran out ends the old link and makes a new one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId, limit: 'hour' });
    harness.send({ type: 'share.record', taskId, url: URL });
    harness.advance(HOUR_MS);
    harness.send({ type: 'task.share', taskId, limit: 'hour' });
    expect(harness.task(taskId).share).toMatchObject({ url: null, endsAt: harness.now + HOUR_MS });
    expect(links(harness, taskId)).toBe(2);
  });

  test('a finished task cannot be shared until it finishes, only for a time', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    expect(() => harness.send({ type: 'task.share', taskId })).toThrow('Pick a time limit instead.');
    harness.send({ type: 'task.share', taskId, limit: 'day' });
    expect(harness.task(taskId).share?.limit).toBe('day');
  });

  test('only the human picks how long, in the settings too', () => {
    const harness = createHarness();
    expect(() =>
      harness.send({ type: 'settings.change', patch: { shareLimit: 'none' } }, { onBehalf: true })
    ).toThrow();
  });
  test('the preset comes from the setting, and changing it keeps the link and when it ends', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'settings.change', patch: { sharePreset: 'status' } });
    harness.send({ type: 'task.share', taskId, limit: 'hour' });
    expect(harness.task(taskId).share).toMatchObject({ preset: 'status', endsAt: harness.now + HOUR_MS });
    harness.send({ type: 'share.record', taskId, url: URL });
    const endsAt = harness.task(taskId).share?.endsAt;
    harness.advance(MINUTE_MS);
    harness.send({ type: 'task.share', taskId, preset: 'default' });
    expect(harness.task(taskId).share).toMatchObject({
      url: URL,
      preset: 'default',
      limit: 'hour',
      endsAt,
    });
    expect(links(harness, taskId)).toBe(1);
    expect(harness.send({ type: 'task.share', taskId, preset: 'default' }).events).toEqual([]);
  });

  test('a preset is read from a command, and only the human picks one, in the settings too', () => {
    expect(parseUserCommand({ type: 'task.share', taskId: 't1', preset: 'status' })).toEqual({
      type: 'task.share',
      taskId: 't1',
      preset: 'status',
    });
    expect(() => parseUserCommand({ type: 'task.share', taskId: 't1', preset: 'all' })).toThrow();
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() =>
      harness.send({ type: 'settings.change', patch: { sharePreset: 'status' } }, { onBehalf: true })
    ).toThrow();
    expect(() =>
      harness.send({ type: 'task.share', taskId, preset: 'default' }, { onBehalf: true })
    ).toThrow();
  });
});
