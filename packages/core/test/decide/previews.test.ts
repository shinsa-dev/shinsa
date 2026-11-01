import { describe, expect, test } from 'bun:test';
import { HOUR_MS, parseUserCommand } from '../../src/index.ts';
import { createHarness, createTask, type Harness } from '../harness.ts';

const URL = 'https://abc.shinsa.page/?key=secret';

function links(harness: Harness, taskId: string, serviceId = 'web') {
  return harness
    .effectsOf('preview.link')
    .filter((effect) => effect.taskId === taskId && effect.serviceId === serviceId).length;
}

function preview(harness: Harness, taskId: string, serviceId = 'web') {
  return harness.task(taskId).previews?.find((entry) => entry.serviceId === serviceId);
}

describe('sharing a preview', () => {
  test('asks for a link once per service and records it in the activity', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web' });
    expect(preview(harness, taskId)).toEqual({
      serviceId: 'web',
      at: harness.now,
      url: null,
      limit: 'until_done',
      endsAt: null,
    });
    expect(links(harness, taskId)).toBe(1);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'you',
      text: 'Shared a preview by link',
    });
    expect(harness.send({ type: 'preview.share', taskId, serviceId: 'web' }).events).toEqual([]);
    harness.send({ type: 'preview.share', taskId, serviceId: 'api', limit: 'hour' });
    expect(preview(harness, taskId, 'api')).toMatchObject({ limit: 'hour', endsAt: harness.now + HOUR_MS });
    expect(links(harness, taskId, 'api')).toBe(1);
    expect(harness.task(taskId).previews).toHaveLength(2);
  });

  test('a new limit keeps the link, and the setting picks the default', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'settings.change', patch: { shareLimit: 'day' } });
    harness.send({ type: 'preview.share', taskId, serviceId: 'web' });
    harness.send({ type: 'preview.record', taskId, serviceId: 'web', url: URL });
    harness.send({ type: 'preview.share', taskId, serviceId: 'web', limit: 'none' });
    expect(preview(harness, taskId)).toMatchObject({ url: URL, limit: 'none', endsAt: null });
    expect(links(harness, taskId)).toBe(1);
    expect(
      harness.task(taskId).activity.filter((entry) => entry.text === 'Shared a preview by link')
    ).toHaveLength(1);
  });

  test('is refused for an automation and a finished task', () => {
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
    expect(() => harness.send({ type: 'preview.share', taskId: 'home', serviceId: 'web' })).toThrow(
      'An automation has no services to share.'
    );
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    expect(() => harness.send({ type: 'preview.share', taskId, serviceId: 'web', limit: 'day' })).toThrow(
      'This task is finished, so its services no longer run here.'
    );
  });

  test('only the human shares or stops sharing a preview', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const refusal = 'Only the human decides what is shared outside this machine.';
    expect(() =>
      harness.send({ type: 'preview.share', taskId, serviceId: 'web' }, { onBehalf: true })
    ).toThrow(refusal);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web' });
    expect(() =>
      harness.send({ type: 'preview.unshare', taskId, serviceId: 'web' }, { onBehalf: true })
    ).toThrow(refusal);
  });

  test('both commands are parsed from the page', () => {
    expect(parseUserCommand({ type: 'preview.share', taskId: 't1', serviceId: 'web' })).toEqual({
      type: 'preview.share',
      taskId: 't1',
      serviceId: 'web',
    });
    expect(
      parseUserCommand({ type: 'preview.share', taskId: 't1', serviceId: 'web', limit: 'week' })
    ).toEqual({
      type: 'preview.share',
      taskId: 't1',
      serviceId: 'web',
      limit: 'week',
    });
    expect(() => parseUserCommand({ type: 'preview.share', taskId: 't1', serviceId: '' })).toThrow();
    expect(parseUserCommand({ type: 'preview.unshare', taskId: 't1', serviceId: 'web' })).toEqual({
      type: 'preview.unshare',
      taskId: 't1',
      serviceId: 'web',
    });
  });
});

describe('a preview link', () => {
  test('is recorded once, and not after sharing stopped', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web' });
    harness.send({ type: 'preview.record', taskId, serviceId: 'web', url: URL });
    expect(preview(harness, taskId)?.url).toBe(URL);
    expect(harness.send({ type: 'preview.record', taskId, serviceId: 'web', url: URL }).events).toEqual([]);
    expect(harness.send({ type: 'preview.record', taskId, serviceId: 'api', url: URL }).events).toEqual([]);
    expect(
      harness.send({ type: 'preview.record', taskId: 'missing', serviceId: 'web', url: URL }).events
    ).toEqual([]);
    harness.send({ type: 'preview.unshare', taskId, serviceId: 'web' });
    expect(harness.send({ type: 'preview.record', taskId, serviceId: 'web', url: URL }).events).toEqual([]);
    expect(harness.task(taskId).previews).toEqual([]);
  });

  test('that could not be made is kept until a record clears it, and sharing again asks once more', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web' });
    const detail = 'Turn on remote access in Settings to share this preview.';
    harness.send({ type: 'preview.fail', taskId, serviceId: 'web', detail });
    expect(preview(harness, taskId)?.failure).toBe(detail);
    expect(harness.send({ type: 'preview.fail', taskId, serviceId: 'web', detail }).events).toEqual([]);
    expect(harness.send({ type: 'preview.fail', taskId, serviceId: 'api', detail }).events).toEqual([]);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web' });
    expect(links(harness, taskId)).toBe(2);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web', limit: 'hour' });
    expect(links(harness, taskId)).toBe(3);
    harness.send({ type: 'preview.record', taskId, serviceId: 'web', url: null });
    expect(preview(harness, taskId)).toMatchObject({ url: null, failure: null });
  });
});

describe('stopping a preview', () => {
  test('drops links still being made and asks again for the other services still waiting', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web' });
    harness.send({ type: 'preview.share', taskId, serviceId: 'api' });
    harness.send({ type: 'preview.share', taskId, serviceId: 'docs' });
    harness.send({ type: 'preview.record', taskId, serviceId: 'docs', url: URL });
    const decision = harness.send({ type: 'preview.unshare', taskId, serviceId: 'web' });
    expect(decision.cancellations).toEqual([
      { taskId, kinds: ['preview.link'], reason: 'The preview is no longer shared.' },
    ]);
    expect(decision.effects).toEqual([{ kind: 'preview.link', taskId, serviceId: 'api' }]);
    expect(harness.task(taskId).previews?.map((entry) => entry.serviceId)).toEqual(['api', 'docs']);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'you',
      text: 'Stopped sharing a preview',
    });
    expect(harness.send({ type: 'preview.unshare', taskId, serviceId: 'web' }).events).toEqual([]);
  });

  test('every preview ends when the task finishes, whatever its limit', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web' });
    harness.send({ type: 'preview.share', taskId, serviceId: 'api', limit: 'none' });
    const decision = harness.send({ type: 'task.cancel', taskId });
    expect(decision.effects.filter((effect) => effect.kind === 'preview.link')).toEqual([]);
    expect(harness.task(taskId).previews).toEqual([]);
    expect(
      harness
        .task(taskId)
        .activity.filter((entry) => entry.text === 'Stopped sharing a preview, since the task finished')
    ).toHaveLength(2);
  });

  test('a time limit ends it once it has passed, and sharing again makes a new link', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web', limit: 'hour' });
    harness.send({ type: 'preview.record', taskId, serviceId: 'web', url: URL });
    expect(harness.send({ type: 'preview.expire', taskId, serviceId: 'web' }).events).toEqual([]);
    harness.advance(HOUR_MS);
    harness.send({ type: 'preview.share', taskId, serviceId: 'web', limit: 'hour' });
    expect(preview(harness, taskId)).toMatchObject({ url: null, endsAt: harness.now + HOUR_MS });
    expect(links(harness, taskId)).toBe(2);
    harness.advance(HOUR_MS);
    harness.send({ type: 'preview.expire', taskId, serviceId: 'web' });
    expect(harness.task(taskId).previews).toEqual([]);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Stopped sharing a preview, since its time ran out',
    });
    expect(harness.send({ type: 'preview.expire', taskId, serviceId: 'web' }).events).toEqual([]);
    expect(harness.send({ type: 'preview.expire', taskId: 'missing', serviceId: 'web' }).events).toEqual([]);
  });
});
