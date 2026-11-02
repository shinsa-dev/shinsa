import { afterEach, describe, expect, test } from 'bun:test';
import type { Extensions } from '../../../src/extensions/index.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { readFailure, startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

function createExtensions() {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string, answer: unknown = { done: name }) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return answer;
    };
  const extensions = {
    isCallback: () => false,
    readSnapshot: record('readSnapshot', { servers: [], skills: [], plugins: [] }),
    check: record('check', Promise.resolve({ done: 'check' })),
    createServer: record('createServer'),
    updateServer: record('updateServer'),
    removeServer: record('removeServer', Promise.resolve({ done: 'removeServer' })),
    updateServerChoice: record('updateServerChoice'),
    startSignIn: record('startSignIn', Promise.resolve({ done: 'startSignIn' })),
    signOut: record('signOut'),
    updateSkillChoice: record('updateSkillChoice'),
    updatePluginChoice: record('updatePluginChoice'),
    updateOptimizer: record('updateOptimizer'),
  };
  return { calls, extensions: extensions as unknown as Extensions };
}

describe('extension routes', () => {
  test('the snapshot and every change pass their fields to the extensions and answer the result', async () => {
    const { calls, extensions } = createExtensions();
    const { send, post } = startRoutes({ extensions });
    expect(await (await send('/api/extensions')).json()).toEqual({ servers: [], skills: [], plugins: [] });
    const changes: [string, Record<string, unknown>, string][] = [
      ['check', { serverId: 's1' }, 'check'],
      ['servers/add', { server: { name: 'maple' } }, 'createServer'],
      ['servers/update', { serverId: 's1', server: { name: 'm' } }, 'updateServer'],
      ['servers/remove', { serverId: 's1' }, 'removeServer'],
      ['servers/choose', { serverId: 's1', enabled: false }, 'updateServerChoice'],
      ['servers/sign-in', { serverId: 's1' }, 'startSignIn'],
      ['servers/sign-out', { serverId: 's1' }, 'signOut'],
      ['skills/choose', { skillId: 'k', enabled: true }, 'updateSkillChoice'],
      ['plugins/choose', { pluginId: 'p', enabled: false }, 'updatePluginChoice'],
      ['optimizer', { enabled: true }, 'updateOptimizer'],
    ];
    for (const [path, body, name] of changes)
      expect(await (await post(`/api/extensions/${path}`, body)).json()).toEqual({ done: name });
    expect(calls).toEqual([
      ['readSnapshot'],
      ['check', 's1'],
      ['createServer', { name: 'maple' }],
      ['updateServer', 's1', { name: 'm' }],
      ['removeServer', 's1'],
      ['updateServerChoice', 's1', { serverId: 's1', enabled: false }],
      ['startSignIn', 's1'],
      ['signOut', 's1'],
      ['updateSkillChoice', 'k', true],
      ['updatePluginChoice', 'p', false],
      ['updateOptimizer', { enabled: true }],
    ]);
  });

  test('a refused change answers its error, and without extensions the routes are not found', async () => {
    const { extensions } = createExtensions();
    (extensions as unknown as { check: () => never }).check = () => {
      throw new Error('No server s9.');
    };
    expect(await readFailure(await startRoutes({ extensions }).post('/api/extensions/check', {}))).toEqual({
      status: 400,
      code: 'request_failed',
      message: 'No server s9.',
    });
    expect((await startRoutes().send('/api/extensions')).status).toBe(404);
  });
});
