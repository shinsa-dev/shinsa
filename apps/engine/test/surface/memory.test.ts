import { describe, expect, test } from 'bun:test';
import { createFakeClient, findSpec, runSpec } from './fixtures.ts';

const PROJECTS = {
  projects: [{ id: 'project-1', name: 'Work', color: 'blue', key: 'WK', folders: [], repos: [] }],
  focus: { projectId: null, until: null },
};

describe('shinsa memory', () => {
  test('lists every rule with its status and scope', async () => {
    const fake = createFakeClient({
      '/api/memory': {
        memory: [
          { id: 'm1', status: 'kept', project: null, text: 'Never use em dashes.' },
          { id: 'm2', status: 'proposed', project: 'Work', text: 'Use bun.' },
        ],
      },
    });
    expect((await runSpec(fake, ['memory', 'list'])).text.split('\n')).toEqual([
      'm1  (kept, every project) Never use em dashes.',
      'm2  (proposed, Work) Use bun.',
    ]);
    const empty = createFakeClient({ '/api/memory': { memory: [] } });
    expect((await runSpec(empty, ['memory', 'list'])).text).toBe('Agents remember nothing yet.');
  });

  test('writes a rule for every project, or for one found by its key', async () => {
    const fake = createFakeClient({ '/api/projects': PROJECTS });
    expect((await runSpec(fake, ['memory', 'write', 'Never', 'use', 'em', 'dashes.'])).text).toContain(
      'Agents remember it.'
    );
    await runSpec(fake, ['memory', 'write', '--id', 'm1', '--project', 'WK', 'Use bun.']);
    expect(fake.sent).toEqual([
      { type: 'memory.write', memoryId: null, projectId: null, text: 'Never use em dashes.' },
      { type: 'memory.write', memoryId: 'm1', projectId: 'project-1', text: 'Use bun.' },
    ]);
  });

  test('changing a rule without --project keeps it where it is', async () => {
    const fake = createFakeClient({
      '/api/memory': {
        memory: [{ id: 'm2', status: 'kept', projectId: 'project-1', project: 'Work', text: 'Use bun.' }],
      },
    });
    await runSpec(fake, ['memory', 'write', '--id', 'm2', 'Use', 'bun', 'everywhere.']);
    await runSpec(fake, ['memory', 'write', '--id', 'gone', 'Use', 'bun.']);
    expect(fake.sent).toEqual([
      { type: 'memory.write', memoryId: 'm2', projectId: 'project-1', text: 'Use bun everywhere.' },
      { type: 'memory.write', memoryId: 'gone', projectId: null, text: 'Use bun.' },
    ]);
  });

  test('keeps or removes a rule by its id, and only the human may', async () => {
    const fake = createFakeClient();
    await runSpec(fake, ['memory', 'keep', 'm1']);
    await runSpec(fake, ['memory', 'remove', 'm2']);
    expect(fake.sent).toEqual([
      { type: 'memory.accept', memoryId: 'm1' },
      { type: 'memory.remove', memoryId: 'm2' },
    ]);
    for (const action of ['write', 'keep', 'remove'])
      expect(findSpec(['memory', action]).humanOnly).toBe(true);
    expect(findSpec(['memory', 'list']).humanOnly).toBeUndefined();
  });
});
