import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { startToolEndpoint, type ToolEndpoint } from '../../../../src/agents/providers/codex/mcp.ts';
import { createShinsaTools } from '../../../../src/agents/tools/index.ts';
import { until } from '../../../helpers/index.ts';

const endpoints: ToolEndpoint[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const endpoint of endpoints.splice(0)) endpoint.close();
});

interface Call {
  name: string;
  requestId: RequestId | undefined;
  signal: AbortSignal;
}

function open(handle?: (call: Call) => Promise<string>) {
  const calls: Call[] = [];
  const tools = createShinsaTools('planner', (name, _input, signal, requestId) => {
    const call = { name, requestId, signal };
    calls.push(call);
    return handle ? handle(call) : Promise.resolve(`${name} done`);
  });
  const endpoint = startToolEndpoint(tools, { heartbeatMs: 5 });
  endpoints.push(endpoint);
  return { endpoint, calls };
}

async function connect(endpoint: ToolEndpoint) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } })
  );
  clients.push(client);
  return client;
}

describe('the tool endpoint Codex calls', () => {
  test('serves the role’s tools on localhost behind a bearer token', async () => {
    const { endpoint, calls } = open();
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = await connect(endpoint);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('propose_plan');
    const result = await client.callTool({ name: 'note', arguments: { text: 'x' } });
    expect(result.content).toEqual([{ type: 'text', text: 'note done' }]);
    expect(String(calls[0]?.requestId)).toMatch(/^1\.\d+$/);
  });

  test('refuses a request without the token, on another path or from a browser', async () => {
    const { endpoint } = open();
    const post = (url: string, headers: Record<string, string>) =>
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
    expect((await post(endpoint.url, {})).status).toBe(401);
    expect((await post(endpoint.url.replace('/mcp', '/other'), endpoint.headers)).status).toBe(404);
    expect((await post(endpoint.url, { ...endpoint.headers, origin: 'https://evil.example' })).status).toBe(
      403
    );
    const garbage = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        ...endpoint.headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: 'not json',
    });
    expect(garbage.status).toBe(400);
    const listen = await fetch(endpoint.url, {
      headers: { ...endpoint.headers, accept: 'text/event-stream' },
    });
    expect(listen.status).toBe(200);
    await listen.body?.cancel();
  });

  test('a long call sends progress, and a reconnecting client gets fresh request ids', async () => {
    const progress: number[] = [];
    let release = () => {};
    const { endpoint, calls } = open(
      () =>
        new Promise((resolve) => {
          release = () => resolve('answered');
        })
    );
    const first = await connect(endpoint);
    const call = first.callTool({ name: 'ask', arguments: { question: 'Which?' } }, undefined, {
      onprogress: (event) => progress.push(event.progress),
    });
    await until('two progress beats', () => progress.length >= 2);
    release();
    expect((await call).content).toEqual([{ type: 'text', text: 'answered' }]);
    const second = await connect(endpoint);
    const again = second.callTool({ name: 'note', arguments: {} });
    await until('the second call', () => calls.length === 2);
    release();
    await again;
    expect(String(calls[1]?.requestId).split('.')[0]).toBe('2');
  });

  test('closing the endpoint stops the calls in flight, and closing twice is fine', async () => {
    const { endpoint, calls } = open(
      (call) => new Promise((resolve) => call.signal.addEventListener('abort', () => resolve('stopped')))
    );
    const client = await connect(endpoint);
    const outcome: string[] = [];
    void client.callTool({ name: 'ask', arguments: {} }).then(
      () => outcome.push('answered'),
      () => outcome.push('dropped')
    );
    await until('the call to arrive', () => calls.length === 1);
    endpoint.close();
    endpoint.close();
    await until('the call to be stopped', () => calls[0]?.signal.aborted === true);
    expect(outcome).not.toContain('answered');
  });

  test('a client that drops a streaming call stops it', async () => {
    const { endpoint, calls } = open(
      (call) => new Promise((resolve) => call.signal.addEventListener('abort', () => resolve('stopped')))
    );
    const headers = {
      ...endpoint.headers,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw', version: '1' },
        },
      }),
    });
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'ask', arguments: {} },
      }),
    });
    await until('the call to arrive', () => calls.length === 1);
    await response.body?.cancel();
    await until('the call to be stopped', () => calls[0]?.signal.aborted === true);
  });
});
