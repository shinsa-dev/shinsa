import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { EngineConfig } from '../../src/config/service.ts';
import { ExtensionStore } from '../../src/extensions/settings/service.ts';
import { ExtensionFiles } from '../../src/extensions/store/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { createConfigAt } from '../helpers/config.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { captureLogs } from '../helpers/logs.ts';

const runtimes: ManagedRuntime.ManagedRuntime<ExtensionStore, never>[] = [];

afterEach(() => Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose())));

function createRoot() {
  return mkdtempSync(join(tmpdir(), 'shinsa-extensions-'));
}

function openStore(root: string) {
  const runtime = ManagedRuntime.make(
    ExtensionStore.layer.pipe(
      Layer.provide(ExtensionFiles.layer),
      Layer.provide(Layer.succeed(EngineConfig, createConfigAt(root))),
      Layer.provide(JsonFileLayer),
      Layer.provide(JsonLogger)
    )
  );
  runtimes.push(runtime);
  return <A>(run: (store: ExtensionStore['Service']) => Effect.Effect<A>) =>
    runtime.runPromise(ExtensionStore.use(run));
}

function readFile(root: string) {
  return openStore(root)((store) => store.read);
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
  test('keeps the variable a copied server signs in with across a restart', async () => {
    const root = createRoot();
    await openStore(root)((store) =>
      store.upsertServer({
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
      })
    );
    const file = await readFile(root);
    expect(file.servers.find((server) => server.id === 'shinsa:maple')?.definition.bearerTokenEnv).toBe(
      'MAPLE_TOKEN'
    );
  });

  test('keeps servers, choices and skills in extensions.json, readable only by you', async () => {
    const root = createRoot();
    const store = openStore(root);
    await store((files) =>
      Effect.all([
        files.upsertServer({
          id: 'shinsa:files',
          name: 'files',
          definition: DEFINITION,
          enabled: true,
          scope: { kind: 'everywhere' },
        }),
        files.updateChoice('claude:linear', { enabled: true }),
        files.updateChoice('claude:linear', { scope: { kind: 'project', project: 'p1' } }),
        files.updateSkill('user:animate', true),
      ])
    );
    expect(await store((files) => Effect.succeed(files.path))).toBe(join(root, 'extensions.json'));
    expect(statSync(join(root, 'extensions.json')).mode & 0o777).toBe(0o600);
    const reread = await readFile(root);
    expect(reread.servers).toHaveLength(1);
    expect(reread.servers[0]?.definition.env).toEqual({ KEY: 'v' });
    expect(reread.choices['claude:linear']).toEqual({
      enabled: true,
      scope: { kind: 'project', project: 'p1' },
    });
    expect(reread.choices['codex:maple']).toBeUndefined();
    expect(reread.skills['user:animate']).toBe(true);
    expect(reread.skills['user:other']).toBeUndefined();
  });

  test('replacing a server keeps one entry, and removing it drops its choices too', async () => {
    const store = openStore(createRoot());
    const server = {
      id: 'shinsa:files',
      name: 'files',
      definition: DEFINITION,
      enabled: true,
      scope: { kind: 'everywhere' as const },
    };
    await store((files) =>
      Effect.andThen(files.upsertServer(server), files.upsertServer({ ...server, enabled: false }))
    );
    expect((await store((files) => files.read)).servers).toEqual([{ ...server, enabled: false }]);
    await store((files) =>
      Effect.andThen(
        files.updateChoice('shinsa:files', { enabled: true }),
        files.removeServer('shinsa:files')
      )
    );
    const file = await store((files) => files.read);
    expect(file.servers).toEqual([]);
    expect(file.choices['shinsa:files']).toBeUndefined();
  });

  test('a damaged entry is dropped and the rest is kept', async () => {
    const root = createRoot();
    writeFileSync(
      join(root, 'extensions.json'),
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
    const file = await readFile(root);
    expect(file.servers.map((server) => [server.id, server.enabled, server.scope])).toEqual([
      ['shinsa:ok', false, { kind: 'repo', path: '/r' }],
    ]);
    expect(file.choices.a ?? {}).toEqual({});
    expect(file.choices.b ?? {}).toEqual({});
    expect(file.skills.s1).toBe(true);
    expect(file.skills.s2).toBeUndefined();
    expect(file.plugins['docs@market']).toBe(false);
    expect(file.plugins.other).toBeUndefined();
    expect(file.statuses.ok).toEqual({
      state: 'connected',
      error: null,
      checkedAt: null,
      tools: [{ name: 'echo', description: null }],
      tokens: null,
    });
    expect(file.statuses.bad).toBeUndefined();
    expect(file.statuses.worse).toBeUndefined();
  });

  test('keeps plugin switches and the last check of each server, and forgets a removed server’s check', async () => {
    const root = createRoot();
    const status = {
      state: 'connected' as const,
      error: null,
      checkedAt: 5,
      tools: [{ name: 'echo', description: 'Echoes.' }],
      tokens: 40,
    };
    await openStore(root)((files) =>
      Effect.all([
        files.updatePlugin('docs@market', false),
        files.writeStatus('claude:files', status),
        files.writeStatus('shinsa:files', status),
        files.removeServer('shinsa:files'),
      ])
    );
    const reread = openStore(root);
    const file = await reread((files) => files.read);
    expect(file.plugins['docs@market']).toBe(false);
    expect(file.statuses['claude:files']).toEqual(status);
    expect(file.statuses['shinsa:files']).toBeUndefined();
    await reread((files) => files.writeStatus('claude:files', null));
    expect((await readFile(root)).statuses['claude:files']).toBeUndefined();
  });

  test('remembers when each server and skill was first seen, writing only what is new', async () => {
    const root = createRoot();
    const store = openStore(root);
    await store((files) => files.recordSeen(['group:maple'], 10));
    await store((files) => files.recordSeen(['group:maple', 'skill:animate'], 20));
    const written = statSync(join(root, 'extensions.json')).mtimeMs;
    await store((files) => files.recordSeen(['group:maple'], 30));
    expect(statSync(join(root, 'extensions.json')).mtimeMs).toBe(written);
    await store((files) => files.updateOptimizer({ days: 30 }));
    const file = await readFile(root);
    expect(file.seen).toEqual({ 'group:maple': 10, 'skill:animate': 20 });
    expect(file.optimizer.days).toBe(30);
  });

  test('a file that is not JSON starts from nothing and says so in the log', async () => {
    const root = createRoot();
    const path = join(root, 'extensions.json');
    writeFileSync(path, '{ broken');
    const logs = captureLogs();
    expect((await readFile(root)).servers).toEqual([]);
    logs.restore();
    expect(logs.fieldsOf('[Extensions] extensions.json could not be read; starting from none')).toEqual([
      expect.objectContaining({ path }),
    ]);
    writeFileSync(path, '[1]');
    expect((await readFile(root)).servers).toEqual([]);
    writeFileSync(path, '{}');
    expect((await readFile(root)).servers).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe('{}');
  });
});
