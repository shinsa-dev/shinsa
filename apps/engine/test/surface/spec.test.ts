import { describe, expect, test } from 'bun:test';
import {
  defineAction,
  defineCommand,
  defineRead,
  describeTaskLink,
  encode,
  readValue,
} from '../../src/surface/spec.ts';
import { BASE, createFakeClient } from './fixtures.ts';

describe('defining surface specs', () => {
  test('a command sends what it builds and says Done. with the task link when there is a task', async () => {
    const spec = defineCommand({
      path: ['x', 'cancel'],
      summary: 'Cancel.',
      fields: [],
      command: 'task.cancel',
      humanOnly: true,
      build: () => ({ type: 'task.cancel', taskId: 'task-1' }),
    });
    expect(spec).toMatchObject({ access: 'write', command: 'task.cancel', humanOnly: true });
    const withTask = createFakeClient({}, 'task-1');
    expect(await spec.run(withTask.client, {})).toEqual({
      data: { ok: true, taskId: 'task-1' },
      text: `Done.\n${BASE}/tasks/task-1`,
    });
    const without = createFakeClient();
    expect((await spec.run(without.client, {})).text).toBe('Done.');
    expect(without.sent).toEqual([{ type: 'task.cancel', taskId: 'task-1' }]);
  });

  test('a command any agent may send does not carry the flag, and its own done text is used', async () => {
    const spec = defineCommand({
      path: ['x', 'done'],
      summary: 'Done.',
      fields: [],
      command: 'task.complete',
      build: () => ({ type: 'task.complete', taskId: 'task-1' }),
      done: () => 'Marked.',
    });
    expect(spec).not.toHaveProperty('humanOnly');
    expect((await spec.run(createFakeClient().client, {})).text).toBe('Marked.');
  });

  test('a read formats what the server answered; humanOnly marks it hidden from task agents', async () => {
    const spec = defineRead({
      path: ['x', 'count'],
      summary: 'Count.',
      fields: [],
      humanOnly: true,
      read: (_values, client) => client.api.state.memory(),
      format: ({ memory }) => `${memory.length} things.`,
    });
    expect(spec).toMatchObject({ access: 'read', humanOnly: true });
    const fake = createFakeClient({ '/api/memory': { memory: [1, 2, 3] } });
    expect(await spec.run(fake.client, {})).toEqual({ data: { memory: [1, 2, 3] }, text: '3 things.' });
    expect(fake.reads).toEqual(['/api/memory']);
    const shown = defineRead({
      path: ['y'],
      summary: 'Y.',
      fields: [],
      read: () => Promise.resolve(null),
      format: () => '',
    });
    expect(shown).not.toHaveProperty('humanOnly');
  });

  test('an action runs as written and is a write', async () => {
    const act = () => Promise.resolve({ data: null, text: 'Acted.' });
    expect(defineAction({ path: ['a'], summary: 'A.', fields: [], humanOnly: true, act })).toMatchObject({
      access: 'write',
      humanOnly: true,
      run: act,
    });
    expect(defineAction({ path: ['a'], summary: 'A.', fields: [], act })).not.toHaveProperty('humanOnly');
  });

  test('helpers: a task link only when there is a task, by its handle when it has one, text values only, and URL-safe parts', () => {
    const { client } = createFakeClient();
    expect(describeTaskLink(client, { ok: true, taskId: 'task-1' })).toBe(`${BASE}/tasks/task-1`);
    expect(describeTaskLink(client, { ok: true, taskId: 'task-1', handle: 'SW-142' })).toBe(
      `${BASE}/tasks/SW-142`
    );
    expect(describeTaskLink(client, { ok: true, taskId: null })).toBe('');
    expect(readValue({ a: 'x', b: 3 }, 'a')).toBe('x');
    expect(readValue({ a: 'x', b: 3 }, 'b')).toBe('');
    expect(readValue({}, 'c')).toBe('');
    expect(encode('Fix the tab/scroll')).toBe('Fix%20the%20tab%2Fscroll');
    expect(encode(4)).toBe('4');
  });
});
