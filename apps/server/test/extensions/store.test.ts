import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtensionStore, parseScope } from '../../src/extensions/store.ts';
import { log } from '../../src/log/index.ts';

function createPath() {
  return join(mkdtempSync(join(tmpdir(), 'shinsa-extensions-')), 'extensions.json');
}

const DEFINITION = {
  transport: 'stdio' as const,
  command: 'npx',
  args: ['server'],
  env: { KEY: 'v' },
  cwd: null,
  url: null,
  headers: {},
  bearerTokenEnv: null,
};

describe('Shinsa’s own MCP and skill settings', () => {
  test('keeps the variable a copied server signs in with across a restart', () => {
    const path = createPath();
    new ExtensionStore(path).upsertServer({
      id: 'shinsa:maple',
      name: 'maple',
      definition: {
        ...DEFINITION,
        transport: 'http',
        command: null,
        args: [],
        env: {},
        url: 'https://api.maple.dev/mcp',
        bearerTokenEnv: 'MAPLE_TOKEN',
      },
      enabled: true,
      scope: { kind: 'everywhere' },
    });
    expect(new ExtensionStore(path).selectServer('shinsa:maple')?.definition.bearerTokenEnv).toBe(
      'MAPLE_TOKEN'
    );
  });

  test('keeps servers, choices and skills in extensions.json, readable only by you', () => {
    const path = createPath();
    const store = new ExtensionStore(path);
    store.upsertServer({
      id: 'shinsa:files',
      name: 'files',
      definition: DEFINITION,
      enabled: true,
      scope: { kind: 'everywhere' },
    });
    store.updateChoice('claude:linear', { enabled: true });
    store.updateChoice('claude:linear', { scope: { kind: 'project', project: 'p1' } });
    store.updateSkill('user:animate', true);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const reread = new ExtensionStore(path);
    expect(reread.listServers()).toHaveLength(1);
    expect(reread.selectServer('shinsa:files')?.definition.env).toEqual({ KEY: 'v' });
    expect(reread.selectChoice('claude:linear')).toEqual({
      enabled: true,
      scope: { kind: 'project', project: 'p1' },
    });
    expect(reread.selectChoice('codex:maple')).toEqual({});
    expect(reread.selectSkill('user:animate')).toBe(true);
    expect(reread.selectSkill('user:other')).toBeNull();
  });

  test('replacing a server keeps one entry, and removing it drops its choices too', () => {
    const store = new ExtensionStore(createPath());
    const server = {
      id: 'shinsa:files',
      name: 'files',
      definition: DEFINITION,
      enabled: true,
      scope: { kind: 'everywhere' as const },
    };
    store.upsertServer(server);
    store.upsertServer({ ...server, enabled: false });
    expect(store.listServers()).toEqual([{ ...server, enabled: false }]);
    store.updateChoice('shinsa:files', { enabled: true });
    store.removeServer('shinsa:files');
    expect(store.listServers()).toEqual([]);
    expect(store.selectChoice('shinsa:files')).toEqual({});
    expect(store.selectServer('shinsa:files')).toBeNull();
  });

  test('a damaged entry is dropped and the rest is kept', () => {
    const path = createPath();
    writeFileSync(
      path,
      JSON.stringify({
        servers: [
          {
            id: 'shinsa:ok',
            name: 'ok',
            definition: { command: 'a' },
            enabled: false,
            scope: { kind: 'repo', path: '/r' },
          },
          { id: 'shinsa:bad', name: 'bad', definition: {} },
          { name: 'no id' },
        ],
        choices: { a: { enabled: 'yes', scope: { kind: 'nowhere' } }, b: 'junk' },
        skills: { s1: true, s2: 'on' },
        plugins: { 'docs@market': false, other: 1 },
        statuses: {
          ok: { state: 'connected', tools: [{ name: 'echo' }, { description: 'no name' }, 'junk'] },
          bad: { state: 'sleeping' },
          worse: 'junk',
        },
      })
    );
    const store = new ExtensionStore(path);
    expect(store.listServers().map((server) => [server.id, server.enabled, server.scope])).toEqual([
      ['shinsa:ok', false, { kind: 'repo', path: '/r' }],
    ]);
    expect(store.selectChoice('a')).toEqual({});
    expect(store.selectChoice('b')).toEqual({});
    expect(store.selectSkill('s1')).toBe(true);
    expect(store.selectSkill('s2')).toBeNull();
    expect(store.selectPlugin('docs@market')).toBe(false);
    expect(store.selectPlugin('other')).toBeNull();
    expect(store.selectStatus('ok')).toEqual({
      state: 'connected',
      error: null,
      checkedAt: null,
      tools: [{ name: 'echo', description: null }],
      tokens: null,
    });
    expect(store.selectStatus('bad')).toBeNull();
    expect(store.selectStatus('worse')).toBeNull();
  });

  test('keeps plugin switches and the last check of each server, and forgets a removed server’s check', () => {
    const path = createPath();
    const store = new ExtensionStore(path);
    const status = {
      state: 'connected' as const,
      error: null,
      checkedAt: 5,
      tools: [{ name: 'echo', description: 'Echoes.' }],
      tokens: 40,
    };
    store.updatePlugin('docs@market', false);
    store.writeStatus('claude:files', status);
    store.writeStatus('shinsa:files', status);
    store.removeServer('shinsa:files');
    const reread = new ExtensionStore(path);
    expect(reread.selectPlugin('docs@market')).toBe(false);
    expect(reread.selectStatus('claude:files')).toEqual(status);
    expect(reread.selectStatus('shinsa:files')).toBeNull();
    reread.writeStatus('claude:files', null);
    expect(new ExtensionStore(path).selectStatus('claude:files')).toBeNull();
  });

  test('a file that is not JSON starts from nothing and says so in the log', () => {
    const path = createPath();
    writeFileSync(path, '{ broken');
    const warn = spyOn(log, 'warn');
    expect(new ExtensionStore(path).listServers()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    writeFileSync(path, '[1]');
    expect(new ExtensionStore(path).listServers()).toEqual([]);
    writeFileSync(path, '{}');
    expect(new ExtensionStore(path).listServers()).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe('{}');
  });

  test('a scope is everywhere, a project or a repository, and anything else is not a scope', () => {
    expect(parseScope({ kind: 'everywhere' })).toEqual({ kind: 'everywhere' });
    expect(parseScope({ kind: 'project', project: 'p1' })).toEqual({ kind: 'project', project: 'p1' });
    expect(parseScope({ kind: 'repo', path: '/r' })).toEqual({ kind: 'repo', path: '/r' });
    expect(parseScope({ kind: 'project', project: '' })).toBeNull();
    expect(parseScope({ kind: 'repo' })).toBeNull();
    expect(parseScope('everywhere')).toBeNull();
  });
});
