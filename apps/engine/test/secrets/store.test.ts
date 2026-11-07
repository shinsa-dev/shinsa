import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureLogs, createTempDir } from '../helpers/index.ts';
import { openTestSecrets } from '../helpers/secrets.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function createStore() {
  const path = join(createTempDir(), 'secrets.json');
  return { path, store: openTestSecrets(path) };
}

describe('one-use secret refs', () => {
  test('a saved value gets a ref only this store can make, and the file is private', () => {
    const { path, store } = createStore();
    const ref = store.writeRef('gate-1', 'task-1', 'hunter2');
    expect(ref).toMatch(/^secret-ref:[0-9a-f]{32}$/);
    expect(store.resolveRef('gate-1')).toBe(ref);
    expect(createStore().store.resolveRef('gate-1')).not.toBe(ref);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8')).refs[ref]).toEqual({
      value: 'hunter2',
      taskId: 'task-1',
      savedAt: 0,
    });
  });

  test('a second answer to the same request replaces the first, so a corrected secret is not lost', () => {
    const { store } = createStore();
    const ref = store.writeRef('gate-1', 'task-1', 'first');
    expect(store.writeRef('gate-1', 'task-1', 'second')).toBe(ref);
    expect(store.removeRef(ref, 'task-1')).toBe('second');
  });

  test('a ref is used once, only by the task that asked', () => {
    const { store } = createStore();
    const ref = store.writeRef('gate-1', 'task-1', 'value');
    expect(() => store.removeRef(ref, 'task-2')).toThrow('belongs to another task');
    expect(store.removeRef(ref, 'task-1')).toBe('value');
    expect(() => store.removeRef(ref, 'task-1')).toThrow('has been used');
    expect(() => store.removeRef('secret-ref:nope', 'task-1')).toThrow('That is not a secret ref');
  });

  test('a ref older than a day is refused and removed', async () => {
    const { store } = createStore();
    const ref = store.writeRef('gate-1', 'task-1', 'value');
    await store.setTime(DAY_MS + 1);
    expect(() => store.removeRef(ref, 'task-1')).toThrow('expired');
    expect(() => store.removeRef(ref, 'task-1')).toThrow('has been used');
  });

  test('removing expired refs drops them and keeps fresh ones', async () => {
    const { path, store } = createStore();
    const old = store.writeRef('gate-1', 'task-1', 'old');
    await store.setTime(DAY_MS);
    const fresh = store.writeRef('gate-2', 'task-1', 'fresh');
    store.removeExpiredRefs();
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).refs)).toEqual([old, fresh]);
    await store.setTime(DAY_MS + 2);
    store.removeExpiredRefs();
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).refs)).toEqual([fresh]);
    expect(store.removeRef(fresh, 'task-1')).toBe('fresh');
    expect(JSON.parse(readFileSync(path, 'utf8')).refs).toEqual({});
  });
});

describe('webhook credentials', () => {
  test('a token is made once and kept; the signing secret can be set and cleared', () => {
    const { store } = createStore();
    expect(store.selectHook('s1')).toBeNull();
    const hook = store.upsertHook('s1');
    expect(hook.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(store.upsertHook('s1')).toEqual(hook);
    store.writeHookSecret('s1', 'shh');
    expect(store.selectHook('s1')).toEqual({ token: hook.token, secret: 'shh' });
    store.writeHookSecret('s1', null);
    expect(store.selectHook('s1')?.secret).toBeNull();
  });

  test('credentials of schedules that are gone are pruned', () => {
    const { path, store } = createStore();
    store.upsertHook('s1');
    store.upsertHook('s2');
    store.pruneHooks(new Set(['s1', 's2']));
    store.pruneHooks(new Set(['s2']));
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).hooks)).toEqual(['s2']);
  });
});

describe('reading the store', () => {
  test('keeps what it can read of a damaged file', () => {
    const path = join(createTempDir(), 'secrets.json');
    writeFileSync(
      path,
      JSON.stringify({
        salt: 'abc',
        refs: { good: { value: 'v', taskId: 't', savedAt: 1 }, bad: { value: 1 }, odd: 'x' },
        hooks: { s1: { token: 't1', secret: 's' }, s2: { token: 't2' }, s3: { secret: 'x' }, s4: 3 },
      })
    );
    const store = openTestSecrets(path);
    expect(store.resolveRef('g')).toBe(openTestSecrets(path).resolveRef('g'));
    expect(store.selectHook('s1')).toEqual({ token: 't1', secret: 's' });
    expect(store.selectHook('s2')).toEqual({ token: 't2', secret: null });
    expect(store.selectHook('s3')).toBeNull();
  });

  test('a file that is not JSON, or has no salt, is kept aside before the next write replaces it', () => {
    const logs = captureLogs();
    for (const content of ['{not json', JSON.stringify({ refs: 'x', hooks: { s1: { token: 't1' } } })]) {
      const dir = createTempDir();
      const path = join(dir, 'secrets.json');
      writeFileSync(path, content);
      const store = openTestSecrets(path);
      expect(store.selectHook('s1')).toBeNull();
      store.upsertHook('s2');
      const kept = readdirSync(dir).filter((name) => name.startsWith('secrets.json.unreadable-'));
      expect(kept).toHaveLength(1);
      expect(readFileSync(join(dir, kept[0] ?? ''), 'utf8')).toBe(content);
    }
    logs.restore();
    const kept = logs.fieldsOf(
      '[Secrets] The secret store could not be read; it was kept aside and an empty one started'
    );
    expect(kept).toHaveLength(2);
    expect(kept).toContainEqual(expect.objectContaining({ problem: 'It has no salt.' }));
  });

  test('a section that is not a map reads as empty, and a signing secret that is not text as none', () => {
    const path = join(createTempDir(), 'secrets.json');
    writeFileSync(
      path,
      JSON.stringify({ salt: 'abc', refs: 'x', hooks: { s1: { token: 't1', secret: 5 } }, mcp: 'junk' })
    );
    const store = openTestSecrets(path);
    expect(store.hasRef('x')).toBe(false);
    expect(store.selectHook('s1')).toEqual({ token: 't1', secret: null });
    expect(store.selectMcpCredentials('junk')).toEqual({});
    writeFileSync(path, JSON.stringify({ salt: 'abc', hooks: [] }));
    expect(openTestSecrets(path).selectHook('0')).toBeNull();
  });

  test('a store without refs or hooks reads as empty', () => {
    const dir = createTempDir();
    const path = join(dir, 'secrets.json');
    writeFileSync(path, JSON.stringify({ salt: 'abc' }));
    const store = openTestSecrets(path);
    expect(store.selectHook('s1')).toBeNull();
    expect(() => store.removeRef(store.resolveRef('g'), 't')).toThrow('has been used');
  });
});

describe('MCP sign-ins', () => {
  test('are kept per server in the private file, merged on update, and forgotten on removal', () => {
    const { path, store } = createStore();
    store.updateMcpCredentials('claude:linear', { tokens: { access_token: 'a' } });
    store.updateMcpCredentials('claude:linear', { verifier: 'v' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const reread = openTestSecrets(path);
    expect(reread.selectMcpCredentials('claude:linear')).toEqual({
      tokens: { access_token: 'a' },
      verifier: 'v',
    });
    reread.removeMcpCredentials('claude:linear');
    expect(openTestSecrets(path).selectMcpCredentials('claude:linear')).toEqual({});
  });

  test('a damaged entry is dropped and the rest is kept', () => {
    const path = join(createTempDir(), 'secrets.json');
    writeFileSync(path, JSON.stringify({ salt: 'abc', mcp: { ok: { verifier: 'v' }, bad: 'junk' } }));
    const store = openTestSecrets(path);
    expect(store.selectMcpCredentials('ok')).toEqual({ verifier: 'v' });
    expect(store.selectMcpCredentials('bad')).toEqual({});
    writeFileSync(path, JSON.stringify({ salt: 'abc', mcp: [] }));
    expect(openTestSecrets(path).selectMcpCredentials('ok')).toEqual({});
  });
});

describe('members’ GitHub tokens', () => {
  const KAI = { token: 'ghp_kai', login: 'Kai', name: 'Kai Lane', email: '7+Kai@users.noreply.github.com' };

  test('are kept per login whatever its case, in the private file, and forgotten on removal', async () => {
    const { path, store } = createStore();
    await store.setTime(5);
    expect(store.writeGitHubToken(KAI)).toEqual({ ...KAI, savedAt: 5 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(openTestSecrets(path).selectGitHubToken('kai')).toEqual({ ...KAI, savedAt: 5 });
    expect(store.selectGitHubToken('mona')).toBeNull();
    store.removeGitHubToken('mona');
    store.removeGitHubToken('KAI');
    expect(openTestSecrets(path).selectGitHubToken('kai')).toBeNull();
  });

  test('a damaged entry is dropped and the rest is kept', () => {
    const path = join(createTempDir(), 'secrets.json');
    writeFileSync(
      path,
      JSON.stringify({ salt: 'abc', github: { kai: { ...KAI, savedAt: 1 }, mona: 'junk' } })
    );
    const store = openTestSecrets(path);
    expect(store.selectGitHubToken('kai')).toEqual({ ...KAI, savedAt: 1 });
    expect(store.selectGitHubToken('mona')).toBeNull();
    writeFileSync(path, JSON.stringify({ salt: 'abc', github: [] }));
    expect(openTestSecrets(path).selectGitHubToken('kai')).toBeNull();
  });
});
