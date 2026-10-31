interface Received {
  path: string;
  headers: Headers;
  body: Record<string, unknown>;
}

export interface FakeAnthropic {
  url: string;
  received: Received[];
  stop: () => Promise<void>;
}

export function startFakeAnthropic(): FakeAnthropic {
  const received: Received[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const text = await request.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      received.push({ path: new URL(request.url).pathname, headers: request.headers, body });
      return Response.json({
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        usage: {
          input_tokens: Math.ceil(text.length / 3.6),
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 1,
        },
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, received, stop: () => server.stop(true) };
}

function createTurn(index: number, output: number) {
  return [
    { role: 'user', content: `Prompt ${index}` },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `tool-${index}`, name: 'Bash', input: { command: 'cat' } }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `tool-${index}`, content: 'x'.repeat(output) }],
    },
    { role: 'assistant', content: [{ type: 'text', text: `Reply ${index}` }] },
  ];
}

export function createMessagesBody(outputs: number[], live = 'Carry on.') {
  return {
    model: 'claude-opus-5-5',
    system: 'You are an agent.',
    tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
    messages: [
      ...outputs.flatMap((output, index) => createTurn(index, output)),
      { role: 'user', content: live },
    ],
  };
}

export function sendMessages(baseUrl: string, sessionId: string | null, body: unknown) {
  return fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer token',
      ...(sessionId ? { 'x-claude-code-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}
