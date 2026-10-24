import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { McpDefinition } from '../../src/extensions/definitions.ts';
import {
  type DeferredServer,
  ExtensionLoader,
  type LoadableExtensions,
  resolveSkillBody,
} from '../../src/extensions/loader.ts';
import { log } from '../../src/log/index.ts';
import { writeSkill } from './fixtures.ts';

const STDIO_SERVER = resolve(import.meta.dirname, '../helpers/mcp/stdio-server.ts');

const open: ExtensionLoader[] = [];

afterEach(async () => {
  for (const loader of open.splice(0)) await loader.close();
});

function stdio(env: Record<string, string> = {}): McpDefinition {
  return {
    transport: 'stdio',
    command: process.execPath,
    args: [STDIO_SERVER],
    env,
    cwd: null,
    url: null,
    headers: {},
    bearerTokenEnv: null,
  };
}

function createServer(name: string, definition = stdio()): DeferredServer {
  return { name, claudeName: name, definition, tools: ['echo'], tokens: 120 };
}

function createLoader(extensions: Partial<LoadableExtensions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-loader-'));
  writeSkill(dir, 'release', 'Cuts a release.');
  const loader = new ExtensionLoader({
    deferred: [
      createServer('echo'),
      { ...createServer('plugin_docs_context'), claudeName: 'plugin:docs:context' },
    ],
    deferredSkills: [
      { name: 'release', description: 'Cuts a release.', path: join(dir, 'release', 'SKILL.md') },
    ],
    loadedNames: ['linear'],
    ...extensions,
  });
  open.push(loader);
  return loader;
}

describe('loading what a run left out', () => {
  test('offers the tools only for what was left out, naming each choice', () => {
    const loader = createLoader();
    expect(loader.listSpecs().map((spec) => spec.name)).toEqual([
      'load_mcp_server',
      'call_mcp_tool',
      'load_skill',
    ]);
    expect(loader.listSpecs()[0]?.description).toContain('echo (1 tool), plugin_docs_context (1 tool)');
    expect(loader.isLoaderTool('load_skill')).toBe(true);
    expect(loader.isLoaderTool('answer')).toBe(false);
    const serversOnly = createLoader({
      deferred: [{ ...createServer('echo'), tools: [] }],
      deferredSkills: [],
    });
    expect(serversOnly.listSpecs().map((spec) => spec.name)).toEqual(['load_mcp_server', 'call_mcp_tool']);
    expect(serversOnly.listSpecs()[0]?.description).toContain('loaded: echo.');
    expect(createLoader({ deferred: [], deferredSkills: [] }).listSpecs()).toEqual([]);
    expect(
      createLoader({ deferred: [{ ...createServer('a'), tools: ['x', 'y'] }] }).listSpecs()[0]?.description
    ).toContain('a (2 tools)');
  });

  test('loads a server straight into a session that can take one, by any of its names', async () => {
    const loader = createLoader();
    const asked: DeferredServer[][] = [];
    loader.attach({
      loadMcpServers: (servers) => {
        asked.push(servers);
        return Promise.resolve({ 'plugin:docs:context': null });
      },
    });
    expect(await loader.handle('load_mcp_server', { name: 'MCP__plugin:docs:context' })).toBe(
      'Loaded plugin_docs_context. Its tools are available to you now as mcp__plugin_docs_context__<tool>. Its tools: echo.'
    );
    expect(asked.map((servers) => servers.map((server) => server.name))).toEqual([['plugin_docs_context']]);
    expect(await loader.handle('load_mcp_server', { name: 'plugin_docs_context' })).toBe(
      'plugin_docs_context is already loaded in this run.'
    );
    const quiet = createLoader({ deferred: [{ ...createServer('quiet'), tools: [] }] });
    quiet.attach({ loadMcpServers: () => Promise.resolve({}) });
    expect(await quiet.handle('load_mcp_server', { name: 'quiet' })).toBe(
      'Loaded quiet. Its tools are available to you now as mcp__quiet__<tool>.'
    );
  });

  test('refuses what it cannot load, listing what it can', async () => {
    const loader = createLoader();
    await expect(loader.handle('load_mcp_server', { name: 'linear' })).rejects.toThrow(
      'linear is already loaded in this run. Use its tools.'
    );
    await expect(loader.handle('load_mcp_server', {})).rejects.toThrow(
      'There is no MCP server named  to load. These can be loaded: echo, plugin_docs_context.'
    );
    await expect(loader.handle('call_mcp_tool', { server: 'echo', tool: 'echo' })).rejects.toThrow(
      'echo is not connected through Shinsa. Load it with load_mcp_server first.'
    );
    await expect(loader.handle('call_mcp_tool', {})).rejects.toThrow('is not connected through Shinsa');
    await expect(loader.handle('load_skill', { name: 'nope' })).rejects.toThrow(
      'There is no skill named nope to load. These can be loaded: release.'
    );
    await expect(loader.handle('load_skill', {})).rejects.toThrow('There is no skill named  to load.');
  });

  test('connects through Shinsa when the session cannot take a server, then calls its tools', async () => {
    const loader = createLoader();
    const reply = await loader.handle('load_mcp_server', { name: 'echo' });
    expect(reply).toStartWith(
      'Connected to echo through Shinsa. Call its tools with call_mcp_tool, server "echo":'
    );
    expect(JSON.parse(reply.split('\n')[1] ?? '[]')).toContainEqual(
      expect.objectContaining({ name: 'echo', description: 'Says back what it gets.' })
    );
    expect(await loader.handle('load_mcp_server', { name: 'echo' })).toBe(
      'echo is already loaded in this run.'
    );
    expect(
      await loader.handle('call_mcp_tool', { server: 'echo', tool: 'echo', arguments: { text: 'x' } })
    ).toBe('hello');
    expect(await loader.handle('call_mcp_tool', { server: 'echo', tool: 'picture', arguments: 'x' })).toBe(
      'Here it is:\n[image]'
    );
    await expect(loader.handle('call_mcp_tool', { server: 'echo', tool: 'refuse' })).rejects.toThrow(
      'No, not today.'
    );
    await expect(loader.handle('call_mcp_tool', { server: 'echo', tool: 'silent' })).rejects.toThrow(
      'silent failed.'
    );
  });

  test('falls back to connecting through Shinsa when the session refuses or fails to load it, and tells the session it gave up', async () => {
    const warn = spyOn(log, 'warn');
    const refused = createLoader();
    refused.attach({ loadMcpServers: () => Promise.resolve({ echo: 'It would not start.' }) });
    expect(await refused.handle('load_mcp_server', { name: 'echo' })).toStartWith(
      'Connected to echo through Shinsa.'
    );
    const broken = createLoader();
    const given: AbortSignal[] = [];
    broken.attach({
      loadMcpServers: (_servers, abandoned) => {
        given.push(abandoned);
        return Promise.reject(new Error('The session has ended.'));
      },
    });
    expect(await broken.handle('load_mcp_server', { name: 'echo' })).toStartWith(
      'Connected to echo through Shinsa.'
    );
    expect(given.map((signal) => signal.aborted)).toEqual([true]);
    const unable = createLoader();
    unable.attach({});
    expect(await unable.handle('load_mcp_server', { name: 'echo' })).toStartWith(
      'Connected to echo through Shinsa.'
    );
    expect(warn).toHaveBeenCalledWith(
      '[Extensions] A server did not load into the session; connecting through Shinsa',
      { server: 'echo', error: 'It would not start.' }
    );
    expect(warn).toHaveBeenCalledWith(
      '[Extensions] Could not load a server into the session; connecting through Shinsa',
      { server: 'echo', error: 'The session has ended.' }
    );
    warn.mockRestore();
  });

  test('a server that fails to answer while connecting through Shinsa is closed again', async () => {
    let closed = 0;
    const loader = new ExtensionLoader(
      { deferred: [createServer('echo')], deferredSkills: [], loadedNames: [] },
      () =>
        Promise.resolve({
          client: { listTools: () => Promise.reject(new Error('No tools today.')) } as never,
          stderr: () => '',
          close: () => {
            closed += 1;
            return Promise.resolve();
          },
        })
    );
    await expect(loader.handle('load_mcp_server', { name: 'echo' })).rejects.toThrow('No tools today.');
    expect(closed).toBe(1);
    await expect(
      createLoader({ deferred: [createServer('broken', stdio({ FAKE_MCP_FAIL: 'no key' }))] }).handle(
        'load_mcp_server',
        { name: 'broken' }
      )
    ).rejects.toThrow('no key');
  });

  test('every connection it opens is closed when the run ends, even one still connecting', async () => {
    const opening = Promise.withResolvers<void>();
    let opened = 0;
    let closed = 0;
    const loader = new ExtensionLoader(
      { deferred: [createServer('echo'), createServer('other')], deferredSkills: [], loadedNames: [] },
      async () => {
        opened += 1;
        await opening.promise;
        return {
          client: { listTools: () => Promise.resolve({ tools: [] }) } as never,
          stderr: () => '',
          close: () => {
            closed += 1;
            return Promise.resolve();
          },
        };
      }
    );
    const loads = Promise.allSettled([
      loader.handle('load_mcp_server', { name: 'echo' }),
      loader.handle('load_mcp_server', { name: 'echo' }),
      loader.handle('load_mcp_server', { name: 'other' }),
    ]);
    await loader.close();
    opening.resolve();
    expect((await loads).map((load) => load.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(opened).toBe(2);
    expect(closed).toBe(2);
  });

  test('reads a skill that was left out, without its front matter', async () => {
    expect(await createLoader().handle('load_skill', { name: 'release' })).toBe('# release');
    expect(resolveSkillBody('No front matter.')).toBe('No front matter.');
  });
});
