export const EMBEDDED_CHAT_BASE = `import { createTransport, type Transport } from './transport';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface EmbeddedChatOptions {
  endpoint: string;
  paywallId: string;
  onMessage: (message: ChatMessage) => void;
}

export class EmbeddedChat {
  private transport: Transport;
  private history: ChatMessage[] = [];

  constructor(private options: EmbeddedChatOptions) {
    this.transport = createTransport(options.endpoint);
  }

  async send(text: string) {
    const message: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    this.history.push(message);
    const reply = await this.transport.post('/chat', {
      paywallId: this.options.paywallId,
      history: this.history,
    });
    const answer: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: reply.text };
    this.history.push(answer);
    this.options.onMessage(answer);
  }

  reset() {
    this.history = [];
  }
}
`;

export const EMBEDDED_CHAT_NEW = `import { McpSession, type McpToolResult } from './mcp-session';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
}

export interface EmbeddedChatOptions {
  serverUrl: string;
  paywallId: string;
  onMessage: (message: ChatMessage) => void;
  signal?: AbortSignal;
}

export class EmbeddedChat {
  private session: McpSession;
  private history: ChatMessage[] = [];

  constructor(private options: EmbeddedChatOptions) {
    this.session = new McpSession(options.serverUrl, { paywallId: options.paywallId });
  }

  async send(text: string) {
    const message: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    this.history.push(message);
    await this.session.ensureConnected(this.options.signal);
    const stream = this.session.complete(this.history, { signal: this.options.signal });
    for await (const part of stream) {
      if (part.kind === 'tool_result') {
        this.record(this.describeTool(part.result));
        continue;
      }
      this.record({ id: part.id, role: 'assistant', text: part.text });
    }
  }

  private record(message: ChatMessage) {
    this.history.push(message);
    this.options.onMessage(message);
  }

  private describeTool(result: McpToolResult): ChatMessage {
    return {
      id: crypto.randomUUID(),
      role: 'tool',
      text: result.isError ? \`\${result.name} failed: \${result.text}\` : result.text,
      toolName: result.name,
    };
  }

  async reset() {
    this.history = [];
    await this.session.close();
  }
}
`;

export const MCP_SESSION_NEW = `import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import type { ChatMessage } from './embedded-chat';

export interface McpToolResult {
  name: string;
  text: string;
  isError: boolean;
}

export type CompletionPart =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool_result'; result: McpToolResult };

const RECONNECT_LIMIT = 3;

export class McpSession {
  private client: Client | null = null;
  private attempts = 0;

  constructor(
    private serverUrl: string,
    private context: { paywallId: string }
  ) {}

  async ensureConnected(signal?: AbortSignal) {
    if (this.client) return;
    if (this.attempts >= RECONNECT_LIMIT) throw new Error('The MCP server is unreachable.');
    this.attempts += 1;
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      requestInit: { headers: { 'x-paywall-id': this.context.paywallId }, signal },
    });
    const client = new Client({ name: 'embedded-chat', version: '2.0.0' });
    await client.connect(transport);
    this.client = client;
    this.attempts = 0;
  }

  async *complete(history: ChatMessage[], options: { signal?: AbortSignal }): AsyncGenerator<CompletionPart> {
    if (!this.client) throw new Error('Call ensureConnected first.');
    const response = await this.client.callTool(
      { name: 'chat.complete', arguments: { history, paywallId: this.context.paywallId } },
      undefined,
      { signal: options.signal }
    );
    for (const item of response.content as { type: string; text?: string; name?: string }[]) {
      if (item.type === 'tool_result') {
        yield { kind: 'tool_result', result: { name: item.name ?? 'tool', text: item.text ?? '', isError: false } };
        continue;
      }
      yield { kind: 'text', id: crypto.randomUUID(), text: item.text ?? '' };
    }
  }

  async close() {
    await this.client?.close();
    this.client = null;
  }
}
`;

export const MCP_SESSION_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { startFakeMcpServer } from '../test/fake-mcp-server';
import { McpSession } from './mcp-session';

describe('McpSession', () => {
  it('gives up after three failed connects', async () => {
    const server = await startFakeMcpServer({ refuse: true });
    const session = new McpSession(server.url, { paywallId: 'pw_1' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(session.ensureConnected()).rejects.toThrow();
    }
    await expect(session.ensureConnected()).rejects.toThrow('The MCP server is unreachable.');
    await server.stop();
  });

  it('sends the paywall id on every request', async () => {
    const server = await startFakeMcpServer();
    const session = new McpSession(server.url, { paywallId: 'pw_1' });
    await session.ensureConnected();
    await Array.fromAsync(session.complete([], {}));
    expect(server.requests.every((request) => request.headers['x-paywall-id'] === 'pw_1')).toBe(true);
    await session.close();
    await server.stop();
  });

  it('yields tool results as their own parts', async () => {
    const server = await startFakeMcpServer({
      content: [
        { type: 'text', text: 'Updating the headline.' },
        { type: 'tool_result', name: 'paywall.update', text: 'Saved.' },
      ],
    });
    const session = new McpSession(server.url, { paywallId: 'pw_1' });
    await session.ensureConnected();
    const parts = await Array.fromAsync(session.complete([], {}));
    expect(parts.map((part) => part.kind)).toEqual(['text', 'tool_result']);
    await session.close();
    await server.stop();
  });
});
`;

export const TRANSPORT_BASE = `export interface Transport {
  post(path: string, body: unknown): Promise<{ text: string }>;
}

export function createTransport(endpoint: string): Transport {
  return {
    async post(path, body) {
      const response = await fetch(new URL(path, endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(\`Chat request failed with \${response.status}\`);
      return (await response.json()) as { text: string };
    },
  };
}
`;

export const DUPLICATE_BASE = `import { db } from '../db';
import type { Paywall } from './types';

export async function duplicatePaywall(paywallId: string, ownerId: string): Promise<Paywall> {
  const source = await db.paywall.findUniqueOrThrow({ where: { id: paywallId } });
  return db.paywall.create({
    data: {
      ...source,
      id: undefined,
      name: \`\${source.name} (copy)\`,
      ownerId,
      createdAt: new Date(),
    },
  });
}
`;

export const DUPLICATE_NEW = `import { db } from '../db';
import { PaywallError } from './errors';
import type { Paywall } from './types';

export async function duplicatePaywall(paywallId: string, ownerId: string): Promise<Paywall> {
  const source = await db.paywall.findUniqueOrThrow({ where: { id: paywallId } });
  if (source.kind === 'code_first') {
    throw new PaywallError('code_first_duplicate', 'Code-first paywalls are duplicated from their repository.');
  }
  return db.paywall.create({
    data: {
      ...source,
      id: undefined,
      name: \`\${source.name} (copy)\`,
      ownerId,
      createdAt: new Date(),
    },
  });
}
`;

export const ERRORS_BASE = `export type PaywallErrorCode = 'not_found' | 'forbidden';

export class PaywallError extends Error {
  constructor(
    readonly code: PaywallErrorCode,
    message: string
  ) {
    super(message);
  }
}
`;

export const ERRORS_NEW = `export type PaywallErrorCode = 'not_found' | 'forbidden' | 'code_first_duplicate';

export class PaywallError extends Error {
  constructor(
    readonly code: PaywallErrorCode,
    message: string
  ) {
    super(message);
  }
}
`;

export const DUPLICATE_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { duplicatePaywall } from './duplicate';
import { seedPaywall } from '../test/seed';

describe('duplicatePaywall', () => {
  it('copies a visual paywall', async () => {
    const paywall = await seedPaywall({ kind: 'visual' });
    const copy = await duplicatePaywall(paywall.id, 'owner-1');
    expect(copy.name).toBe(\`\${paywall.name} (copy)\`);
  });

  it('refuses a code-first paywall', async () => {
    const paywall = await seedPaywall({ kind: 'code_first' });
    await expect(duplicatePaywall(paywall.id, 'owner-1')).rejects.toThrow('duplicated from their repository');
  });
});
`;
