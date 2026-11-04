import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { UsageIndexLimits } from '../../src/extensions/usage-index/schema.ts';
import { UsageIndex } from '../../src/extensions/usage-index/service.ts';
import { normalizeServerName, resolveServerLabel } from '../../src/extensions/usage/names.ts';
import type { ExtensionUsage } from '../../src/extensions/usage/service.ts';
import { captureLogs } from '../helpers/logs.ts';
import { serializeClaudeToolUse, serializeShinsaToolCall, writeFile } from './fixtures.ts';
import { createFoundation } from './harness.ts';

const DAY = 86_400_000;

const NOW = Date.parse('2026-10-20T12:00:00Z');

const runtimes: { dispose: () => Promise<void> }[] = [];

afterEach(() => Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose())));

function createDirs() {
  const root = mkdtempSync(join(tmpdir(), 'shinsa-usage-'));
  return {
    root,
    claude: join(root, 'claude', 'projects'),
    shinsa: join(root, 'transcripts'),
    cache: join(root, 'data', 'extension-usage.json'),
  };
}

interface IndexOptions {
  chunkBytes?: number;
  usage?: (real: ExtensionUsage['Service']) => ExtensionUsage['Service'];
}

async function createIndex(dirs: ReturnType<typeof createDirs>, options: IndexOptions = {}) {
  const foundation = createFoundation({
    root: dirs.root,
    config: { dataDir: join(dirs.root, 'data'), transcriptsDir: dirs.shinsa },
    now: () => NOW,
    ...(options.usage ? { usage: options.usage } : {}),
  });
  const limits = Layer.succeed(UsageIndexLimits, {
    horizonDays: 90,
    chunkBytes: options.chunkBytes ?? 8 * 1024 * 1024,
  });
  const runtime = ManagedRuntime.make(
    UsageIndex.layer({ CLAUDE_CONFIG_DIR: join(dirs.root, 'claude') }).pipe(
      Layer.provide(limits),
      Layer.provideMerge(foundation)
    )
  );
  runtimes.push(runtime);
  const index = await runtime.runPromise(UsageIndex.use(Effect.succeed));
  const run = <A>(effect: Effect.Effect<A>) => runtime.runPromise(effect);
  return {
    read: async () => (await run(index.view)).read,
    selectServer: async (name: string) => (await run(index.view)).selectServer(name),
    selectSkill: async (name: string) => (await run(index.view)).selectSkill(name),
    isStale: (maxAgeMs: number) => run(index.isStale(maxAgeMs)),
    refresh: () => run(index.refresh),
    stop: () => run(index.stop),
  };
}

describe('reading which servers and skills agents used', () => {
  test('reads Claude Code sessions and Shinsa’s transcripts, keeping each one’s latest use', async () => {
    const dirs = createDirs();
    writeFile(
      join(dirs.claude, '-code-app', 'one.jsonl'),
      [
        serializeClaudeToolUse('mcp__maple__search', NOW - 3 * DAY),
        serializeClaudeToolUse('mcp__maple__search', NOW - 9 * DAY),
        serializeClaudeToolUse('mcp__plugin_docs_context__lookup', NOW - DAY),
        serializeClaudeToolUse('Skill', NOW - 2 * DAY, { skill: 'animate' }),
        serializeClaudeToolUse('Bash', NOW, { command: 'ls' }),
        JSON.stringify({ type: 'system', tools: [{ name: 'mcp__linear__list' }] }),
        '',
      ].join('\n')
    );
    writeFile(
      join(dirs.claude, '-code-app', 'one', 'subagents', 'two.jsonl'),
      `${serializeClaudeToolUse('mcp__superwall-v2__apps', NOW - 4 * DAY)}\n`
    );
    writeFile(
      join(dirs.shinsa, 'run-1.jsonl'),
      [
        serializeShinsaToolCall({ kind: 'mcp', server: 'context', name: 'lookup', args: {} }, NOW - 5 * DAY),
        serializeShinsaToolCall({ kind: 'other', name: 'Skill', args: { skill: 'docs:lookup-docs' } }, NOW),
        serializeShinsaToolCall(
          { kind: 'mcp', server: 'shinsa', name: 'load_mcp_server', args: { name: 'linear' } },
          NOW - 6 * DAY
        ),
        serializeShinsaToolCall(
          { kind: 'mcp', server: 'shinsa', name: 'call_mcp_tool', args: { server: 'posthog' } },
          NOW - 7 * DAY
        ),
        serializeShinsaToolCall({ kind: 'mcp', server: 'shinsa', name: 'load_mcp_server', args: {} }, NOW),
        serializeShinsaToolCall({ kind: 'mcp', server: 'shinsa', name: 'tasks_done', args: {} }, NOW),
        serializeShinsaToolCall({ kind: 'other', name: 'Skill', args: {} }, NOW),
        JSON.stringify({ type: 'agent', text: '"kind":"mcp"' }),
        '{"kind":"mcp" broken',
        '',
      ].join('\n')
    );
    writeFile(join(dirs.shinsa, 'notes.txt'), 'not a transcript');
    const index = await createIndex(dirs);
    expect(await index.read()).toEqual({ readAt: null, since: null });
    expect(await index.isStale(1000)).toBe(true);
    await index.refresh();
    expect(await index.read()).toEqual({ readAt: NOW, since: NOW - 90 * DAY });
    expect(await index.isStale(1000)).toBe(false);
    expect(await index.selectServer('maple')).toBe(NOW - 3 * DAY);
    expect(await index.selectServer('plugin_docs_context')).toBe(NOW - DAY);
    expect(await index.selectServer('plugin:docs:context')).toBe(NOW - DAY);
    expect(await index.selectServer('superwall-v2')).toBe(NOW - 4 * DAY);
    expect(await index.selectServer('linear')).toBe(NOW - 6 * DAY);
    expect(await index.selectServer('posthog')).toBe(NOW - 7 * DAY);
    expect(await index.selectServer('kampala')).toBeNull();
    expect(await index.selectSkill('animate')).toBe(NOW - 2 * DAY);
    expect(await index.selectSkill('docs:lookup-docs')).toBe(NOW);
    expect(await index.selectSkill('release')).toBeNull();
  });

  test('a later read picks up only what was appended, and survives a restart through its cache', async () => {
    const dirs = createDirs();
    const file = join(dirs.claude, 'p', 'live.jsonl');
    writeFile(file, `${serializeClaudeToolUse('mcp__maple__a', NOW - 20 * DAY)}\n{"partial":`);
    const index = await createIndex(dirs);
    await index.refresh();
    expect(await index.selectServer('maple')).toBe(NOW - 20 * DAY);
    appendFileSync(file, `"line"}\n${serializeClaudeToolUse('mcp__maple__b', NOW - 2 * DAY)}\n`);
    await index.refresh();
    expect(await index.selectServer('maple')).toBe(NOW - 2 * DAY);
    const reopened = await createIndex(dirs);
    expect(await reopened.selectServer('maple')).toBe(NOW - 2 * DAY);
    const unchanged = statSync(file);
    writeFileSync(file, readFileSync(file, 'utf8').replace('mcp__maple__b', 'mcp__zzzzz__b'));
    utimesSync(file, unchanged.atime, unchanged.mtime);
    await reopened.refresh();
    expect(await reopened.selectServer('zzzzz')).toBeNull();
  });

  test('reads a line longer than its buffer, a rewritten file from the start, and skips files past the horizon', async () => {
    const dirs = createDirs();
    const long = join(dirs.claude, 'p', 'long.jsonl');
    writeFile(
      long,
      `${JSON.stringify({ pad: 'x'.repeat(200) })}\n${serializeClaudeToolUse('mcp__maple__a', NOW - DAY)}\n`
    );
    const old = join(dirs.claude, 'p', 'old.jsonl');
    writeFile(old, `${serializeClaudeToolUse('mcp__kampala__a', NOW - 200 * DAY)}\n`);
    utimesSync(old, new Date(NOW - 200 * DAY), new Date(NOW - 200 * DAY));
    const index = await createIndex(dirs, { chunkBytes: 16 });
    await index.refresh();
    expect(await index.selectServer('maple')).toBe(NOW - DAY);
    expect(await index.selectServer('kampala')).toBeNull();
    writeFileSync(long, `${serializeClaudeToolUse('mcp__linear__a', NOW)}\n`);
    await index.refresh();
    expect(await index.selectServer('linear')).toBe(NOW);
  });

  test('starts over from a cache it cannot read, and a missing folder reads as nothing used', async () => {
    const dirs = createDirs();
    mkdirSync(join(dirs.root, 'data'), { recursive: true });
    writeFileSync(dirs.cache, '{broken');
    const logs = captureLogs();
    const index = await createIndex(dirs);
    logs.restore();
    expect(
      logs.fieldsOf('[Extensions] The usage cache could not be read; reading the sessions again')
    ).toEqual([expect.objectContaining({ path: dirs.cache })]);
    writeFileSync(dirs.cache, JSON.stringify([1]));
    expect(await (await createIndex(dirs)).read()).toEqual({ readAt: null, since: null });
    writeFileSync(
      dirs.cache,
      JSON.stringify({ files: { a: { size: 'x' }, b: { size: 1, mtimeMs: 1, offset: 1 } }, servers: 'x' })
    );
    expect(await (await createIndex(dirs)).selectServer('a')).toBeNull();
    writeFileSync(dirs.cache, JSON.stringify({ servers: { maple: 5 }, readAt: 9, since: 1 }));
    expect(await (await createIndex(dirs)).selectServer('maple')).toBe(5);
    expect(await (await createIndex(dirs)).read()).toEqual({ readAt: 9, since: 1 });
    await index.refresh();
    expect((await index.read()).readAt).toBe(NOW);
  });

  test('a session it cannot read is logged and skipped', async () => {
    const dirs = createDirs();
    writeFile(join(dirs.claude, 'p', 'gone.jsonl'), `${serializeClaudeToolUse('mcp__maple__a', NOW)}\n`);
    const file = spyOn(Bun, 'file').mockImplementation(() => {
      throw new Error('denied');
    });
    const logs = captureLogs();
    const index = await createIndex(dirs);
    await index.refresh().finally(() => {
      file.mockRestore();
      logs.restore();
    });
    expect(logs.fieldsOf('[Extensions] Could not read a session for usage')).toEqual([
      expect.objectContaining({ error: 'denied' }),
    ]);
  });

  test('a transcript line it cannot read is logged and skipped', async () => {
    const dirs = createDirs();
    const transcript = join(dirs.shinsa, 'task.jsonl');
    writeFile(transcript, '{"type":"tool_call","tool":{"kind":"mcp",\n');
    const logs = captureLogs();
    await (await createIndex(dirs)).refresh().finally(() => logs.restore());
    expect(logs.fieldsOf('[Extensions] Skipped a transcript line it could not read for usage')).toEqual([
      expect.objectContaining({ path: transcript }),
    ]);
  });

  test('a usage cache it cannot write fails the read', async () => {
    const dirs = createDirs();
    mkdirSync(dirs.cache, { recursive: true });
    await expect((await createIndex(dirs)).refresh()).rejects.toThrow();
  });

  test('one read at a time, and a stop ends a read before it records anything', async () => {
    const dirs = createDirs();
    writeFile(join(dirs.claude, 'p', 'a.jsonl'), `${serializeClaudeToolUse('mcp__maple__a', NOW)}\n`);
    let scans = 0;
    const index = await createIndex(dirs, {
      usage: (real) => ({
        scan: (scan, previous) =>
          Effect.suspend(() => {
            scans += 1;
            return real.scan(scan, previous);
          }),
      }),
    });
    await Promise.all([index.refresh(), index.refresh()]);
    expect(scans).toBe(1);
    const fresh = createDirs();
    writeFile(join(fresh.claude, 'p', 'a.jsonl'), `${serializeClaudeToolUse('mcp__maple__a', NOW)}\n`);
    const stopped = await createIndex(fresh);
    const reading = stopped.refresh();
    await stopped.stop();
    await reading;
    expect((await stopped.read()).readAt).toBeNull();
    await stopped.refresh();
    expect((await stopped.read()).readAt).toBeNull();
    expect(await (await createIndex(dirs)).stop()).toBeUndefined();
  });

  test('names match the way Claude Code writes them, and Shinsa’s chat keeps only the last part', () => {
    expect(normalizeServerName('plugin:docs:context')).toBe('plugin_docs_context');
    expect(normalizeServerName('superwall-v2')).toBe('superwall-v2');
    expect(resolveServerLabel('plugin_docs_context')).toBe('context');
    expect(resolveServerLabel('__')).toBe('__');
  });
});
