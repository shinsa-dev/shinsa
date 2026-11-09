import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureLogs, createTempDir } from '../helpers/index.ts';
import { openTestSecrets } from '../helpers/secrets.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

async function createStore() {
  const path = join(createTempDir(), 'secrets.json');
  return { path, store: await openTestSecrets(path) };
}

describe('one-use secret refs', () => {
  test('a saved value gets a ref only this store can make, and the file is private', async () => {
    const { path, store } = await createStore();
    const ref = await store.writeRef('gate-1', 'task-1', 'hunter2');
    expect(ref).toMatch(/^secret-ref:[0-9a-f]{32}$/);
    expect(await store.resolveRef('gate-1')).toBe(ref);
    expect(await (await createStore()).store.resolveRef('gate-1')).not.toBe(ref);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8')).refs[ref]).toEqual({
      value: 'hunter2',
      taskId: 'task-1',
      savedAt: 0,
    });
  });

  test('a second answer to the same request replaces the first, so a corrected secret is not lost', async () => {
    const { store } = await createStore();
    const ref = await store.writeRef('gate-1', 'task-1', 'first');
    expect(await store.writeRef('gate-1', 'task-1', 'second')).toBe(ref);
    expect(await store.removeRef(ref, 'task-1')).toBe('second');
  });

  test('a ref is used once, only by the task that asked', async () => {
    const { store } = await createStore();
    const ref = await store.writeRef('gate-1', 'task-1', 'value');
    await expect(store.removeRef(ref, 'task-2')).rejects.toThrow('belongs to another task');
    expect(await store.removeRef(ref, 'task-1')).toBe('value');
    await expect(store.removeRef(ref, 'task-1')).rejects.toThrow('has been used');
    await expect(store.removeRef('secret-ref:nope', 'task-1')).rejects.toThrow('That is not a secret ref');
  });

  test('a ref older than a day is refused and removed', async () => {
    const { store } = await createStore();
    const ref = await store.writeRef('gate-1', 'task-1', 'value');
    await store.setTime(DAY_MS + 1);
    await expect(store.removeRef(ref, 'task-1')).rejects.toThrow('expired');
    await expect(store.removeRef(ref, 'task-1')).rejects.toThrow('has been used');
  });

  test('removing expired refs drops them and keeps fresh ones', async () => {
    const { path, store } = await createStore();
    const old = await store.writeRef('gate-1', 'task-1', 'old');
    await store.setTime(DAY_MS);
    const fresh = await store.writeRef('gate-2', 'task-1', 'fresh');
    await store.removeExpiredRefs();
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).refs)).toEqual([old, fresh]);
    await store.setTime(DAY_MS + 2);
    await store.removeExpiredRefs();
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).refs)).toEqual([fresh]);
    expect(await store.removeRef(fresh, 'task-1')).toBe('fresh');
    expect(JSON.parse(readFileSync(path, 'utf8')).refs).toEqual({});
  });
});

describe('webhook credentials', () => {
  test('a token is made once and kept; the signing secret can be set and cleared', async () => {
    const { store } = await createStore();
    expect(await store.selectHook('s1')).toBeNull();
    const hook = await store.upsertHook('s1');
    expect(hook.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await store.upsertHook('s1')).toEqual(hook);
    await store.writeHookSecret('s1', 'shh');
    expect(await store.selectHook('s1')).toEqual({ token: hook.token, secret: 'shh' });
    await store.writeHookSecret('s1', null);
    expect((await store.selectHook('s1'))?.secret).toBeNull();
  });

  test('credentials of schedules that are gone are pruned', async () => {
    const { path, store } = await createStore();
    await store.upsertHook('s1');
    await store.upsertHook('s2');
    await store.pruneHooks(new Set(['s1', 's2']));
    await store.pruneHooks(new Set(['s2']));
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).hooks)).toEqual(['s2']);
  });
});

describe('reading the store', () => {
  test('keeps what it can read of a damaged file', async () => {
    const path = join(createTempDir(), 'secrets.json');
    writeFileSync(
      path,
      JSON.stringify({
        salt: 'abc',
        refs: { good: { value: 'v', taskId: 't', savedAt: 1 }, bad: { value: 1 }, odd: 'x' },
        hooks: { s1: { token: 't1', secret: 's' }, s2: { token: 't2' }, s3: { secret: 'x' }, s4: 3 },
      })
    );
    const store = await openTestSecrets(path);
    expect(await store.resolveRef('g')).toBe(await (await openTestSecrets(path)).resolveRef('g'));
    expect(await store.selectHook('s1')).toEqual({ token: 't1', secret: 's' });
    expect(await store.selectHook('s2')).toEqual({ token: 't2', secret: null });
    expect(await store.selectHook('s3')).toBeNull();
  });

  test('a file that is not JSON, or has no salt, is kept aside before the next write replaces it', async () => {
    const logs = captureLogs();
    for (const content of ['{not json', JSON.stringify({ refs: 'x', hooks: { s1: { token: 't1' } } })]) {
      const dir = createTempDir();
      const path = join(dir, 'secrets.json');
      writeFileSync(path, content);
      const store = await openTestSecrets(path);
      expect(await store.selectHook('s1')).toBeNull();
      await store.upsertHook('s2');
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

  test('a section that is not a map reads as empty, and a signing secret that is not text as none', async () => {
    const path = join(createTempDir(), 'secrets.json');
    writeFileSync(
      path,
      JSON.stringify({ salt: 'abc', refs: 'x', hooks: { s1: { token: 't1', secret: 5 } }, mcp: 'junk' })
    );
    const store = await openTestSecrets(path);
    expect(await store.hasRef('x')).toBe(false);
    expect(await store.selectHook('s1')).toEqual({ token: 't1', secret: null });
    expect(await store.selectMcpCredentials('junk')).toEqual({});
    writeFileSync(path, JSON.stringify({ salt: 'abc', hooks: [] }));
    expect(await (await openTestSecrets(path)).selectHook('0')).toBeNull();
  });

  test('a store without refs or hooks reads as empty', async () => {
    const dir = createTempDir();
    const path = join(dir, 'secrets.json');
    writeFileSync(path, JSON.stringify({ salt: 'abc' }));
    const store = await openTestSecrets(path);
    expect(await store.selectHook('s1')).toBeNull();
    await expect(store.removeRef(await store.resolveRef('g'), 't')).rejects.toThrow('has been used');
  });
});

describe('MCP sign-ins', () => {
  test('are kept per server in the private file, merged on update, and forgotten on removal', async () => {
    const { path, store } = await createStore();
    await store.updateMcpCredentials('claude:linear', { tokens: { access_token: 'a' } });
    await store.updateMcpCredentials('claude:linear', { verifier: 'v' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const reread = await openTestSecrets(path);
    expect(await reread.selectMcpCredentials('claude:linear')).toEqual({
      tokens: { access_token: 'a' },
      verifier: 'v',
    });
    await reread.removeMcpCredentials('claude:linear');
    expect(await (await openTestSecrets(path)).selectMcpCredentials('claude:linear')).toEqual({});
  });

  test('a damaged entry is dropped and the rest is kept', async () => {
    const path = join(createTempDir(), 'secrets.json');
    writeFileSync(path, JSON.stringify({ salt: 'abc', mcp: { ok: { verifier: 'v' }, bad: 'junk' } }));
    const store = await openTestSecrets(path);
    expect(await store.selectMcpCredentials('ok')).toEqual({ verifier: 'v' });
    expect(await store.selectMcpCredentials('bad')).toEqual({});
    writeFileSync(path, JSON.stringify({ salt: 'abc', mcp: [] }));
    expect(await (await openTestSecrets(path)).selectMcpCredentials('ok')).toEqual({});
  });
});

describe('members’ GitHub tokens', () => {
  const KAI = { token: 'ghp_kai', login: 'Kai', name: 'Kai Lane', email: '7+Kai@users.noreply.github.com' };

  test('are kept per login whatever its case, in the private file, and forgotten on removal', async () => {
    const { path, store } = await createStore();
    await store.setTime(5);
    expect(await store.writeGitHubToken(KAI)).toEqual({ ...KAI, savedAt: 5 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await (await openTestSecrets(path)).selectGitHubToken('kai')).toEqual({ ...KAI, savedAt: 5 });
    expect(await store.selectGitHubToken('mona')).toBeNull();
    await store.removeGitHubToken('mona');
    await store.removeGitHubToken('KAI');
    expect(await (await openTestSecrets(path)).selectGitHubToken('kai')).toBeNull();
  });

  test('a damaged entry is dropped and the rest is kept', async () => {
    const path = join(createTempDir(), 'secrets.json');
    writeFileSync(
      path,
      JSON.stringify({ salt: 'abc', github: { kai: { ...KAI, savedAt: 1 }, mona: 'junk' } })
    );
    const store = await openTestSecrets(path);
    expect(await store.selectGitHubToken('kai')).toEqual({ ...KAI, savedAt: 1 });
    expect(await store.selectGitHubToken('mona')).toBeNull();
    writeFileSync(path, JSON.stringify({ salt: 'abc', github: [] }));
    expect(await (await openTestSecrets(path)).selectGitHubToken('kai')).toBeNull();
  });
});
