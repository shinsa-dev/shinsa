import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Layer, ManagedRuntime } from 'effect';
import type { McpDefinition } from '../../src/extensions/definitions.ts';
import { McpClients } from '../../src/extensions/health/service.ts';
import { MCP_CHECK_TIMEOUT } from '../../src/extensions/schema.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { captureLogs } from '../helpers/logs.ts';
import { type FakeMcpHttp, startFakeMcpHttp } from '../helpers/mcp/http.ts';

const runtime = ManagedRuntime.make(Layer.merge(McpClients.layer, JsonLogger));

afterAll(() => runtime.dispose());

function createServerCheck(timeout: number | typeof MCP_CHECK_TIMEOUT = MCP_CHECK_TIMEOUT) {
  return (definition: McpDefinition) =>
    runtime.runPromise(McpClients.use((clients) => clients.check(definition, timeout)));
}

const STDIO_SERVER = join(import.meta.dirname, '..', 'helpers', 'mcp', 'stdio-server.ts');

let fake: FakeMcpHttp | null = null;

afterEach(async () => {
  await fake?.stop();
  fake = null;
});

function stdio(env: Record<string, string> = {}, command = process.execPath): McpDefinition {
  return {
    transport: 'stdio',
    command,
    args: [STDIO_SERVER],
    env,
    cwd: null,
    url: null,
    headers: {},
    bearerTokenEnv: null,
  };
}

function remote(
  url: string,
  headers: Record<string, string> = {},
  transport: 'http' | 'sse' = 'http'
): McpDefinition {
  return { transport, command: null, args: [], env: {}, cwd: null, url, headers, bearerTokenEnv: null };
}

describe('checking an MCP server', () => {
  test('a command server that starts is connected, with its tools', async () => {
    const status = await createServerCheck()(stdio());
    expect(status).toMatchObject({ state: 'connected', error: null });
    expect(status.tools.map((tool) => tool.name)).toEqual(['echo', 'refuse', 'silent', 'picture']);
    expect(status.tools[0]).toEqual({ name: 'echo', description: 'Says back what it gets.' });
    expect(status.tokens).toBeGreaterThan(100);
  });

  test('a command server that exits is failing, with what it printed', async () => {
    const status = await createServerCheck()(stdio({ FAKE_MCP_FAIL: 'missing API key' }));
    expect(status.state).toBe('failing');
    expect(status.error).toContain('missing API key');
  });

  test('a command that does not exist is failing', async () => {
    const status = await createServerCheck()(stdio({}, '/nonexistent/mcp-server'));
    expect(status.state).toBe('failing');
    expect(status.error).toBeTruthy();
  });

  test('a connection that will not close is logged, and the check still answers', async () => {
    const closeClient = Client.prototype.close;
    const close = spyOn(Client.prototype, 'close').mockImplementation(async function (this: Client) {
      await closeClient.call(this);
      throw new Error('already gone');
    });
    const logs = captureLogs();
    const status = await createServerCheck()(stdio()).finally(() => {
      close.mockRestore();
      logs.restore();
    });
    expect(status.state).toBe('connected');
    expect(logs.fieldsOf('[Extensions] Could not close an MCP connection')).toEqual([
      { transport: 'stdio', error: 'already gone' },
    ]);
  });

  test('a remote server that wants a token needs sign-in', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const status = await createServerCheck()(remote(fake.mcpUrl));
    expect(status).toEqual({
      state: 'needs_sign_in',
      error: 'The server wants you to sign in.',
      tools: [],
      tokens: null,
    });
  });

  test('a remote server is connected with the headers it is given', async () => {
    fake = startFakeMcpHttp({ tools: [{ name: 'search', description: 'x'.repeat(250) }] });
    const status = await createServerCheck()(remote(fake.mcpUrl, { 'X-Team': 'core' }));
    expect(status.state).toBe('connected');
    expect(status.tools[0]?.name).toBe('search');
    expect(status.tools[0]?.description).toHaveLength(200);
    expect(fake.requests.some((request) => request.path === '/mcp')).toBe(true);
  });

  test('a tool without a description reads as none', async () => {
    fake = startFakeMcpHttp({ tools: [{ name: 'bare', description: '' }] });
    const status = await createServerCheck()(remote(fake.mcpUrl));
    expect(status.tools).toEqual([{ name: 'bare', description: null }]);
  });

  test('a server that never answers is failing after the time limit', async () => {
    const silent = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Promise<Response>(() => {}),
    });
    try {
      const status = await createServerCheck(100)(remote(`http://127.0.0.1:${silent.port}/mcp`));
      expect(status).toMatchObject({ state: 'failing', error: 'No answer within 0.1 seconds.' });
    } finally {
      await silent.stop(true);
    }
  });

  test('a remote server whose address is not a URL is failing', async () => {
    const status = await createServerCheck()(remote('not a url'));
    expect(status.state).toBe('failing');
    expect(status.error).toBeTruthy();
  });

  test('an SSE server that is not there is failing', async () => {
    const status = await createServerCheck(2_000)(remote('http://127.0.0.1:9/sse', {}, 'sse'));
    expect(status.state).toBe('failing');
  });
});
