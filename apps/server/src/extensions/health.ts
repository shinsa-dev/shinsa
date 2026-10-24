import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { type McpServerStatus, resolveTokenEstimate } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { McpDefinition } from './definitions.ts';

export type ServerCheck = (definition: McpDefinition) => Promise<Omit<McpServerStatus, 'checkedAt'>>;

const CHECK_TIMEOUT_MS = 15_000;

const STDERR_LIMIT = 400;

const TOOL_DESCRIPTION_LIMIT = 200;

interface CheckTransport {
  transport: Transport;
  stderr: () => string;
}

function resolveProcessEnv(extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return { ...env, ...extra };
}

function createTransport(definition: McpDefinition): CheckTransport {
  if (definition.transport === 'stdio') {
    const transport = new StdioClientTransport({
      command: definition.command ?? '',
      args: definition.args,
      env: resolveProcessEnv(definition.env),
      ...(definition.cwd ? { cwd: definition.cwd } : {}),
      stderr: 'pipe',
    });
    let output = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-STDERR_LIMIT);
    });
    return { transport, stderr: () => output.trim() };
  }
  const url = new URL(definition.url ?? '');
  const requestInit = { headers: definition.headers };
  const transport =
    definition.transport === 'sse'
      ? new SSEClientTransport(url, { requestInit })
      : new StreamableHTTPClientTransport(url, { requestInit });
  return { transport, stderr: () => '' };
}

function isUnauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) return true;
  const code = (error as { code?: unknown }).code;
  return code === 401 || /\b401\b|unauthori[sz]ed/i.test(describeError(error));
}

function clipToolDescription(text: string | undefined) {
  if (!text) return null;
  return text.length > TOOL_DESCRIPTION_LIMIT ? `${text.slice(0, TOOL_DESCRIPTION_LIMIT - 1)}…` : text;
}

export function withTimeout<T>(work: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer within ${timeoutMs / 1000} seconds.`)), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export interface OpenedClient {
  client: Client;
  stderr: () => string;
  close: () => Promise<void>;
}

export async function openMcpClient(
  definition: McpDefinition,
  timeoutMs = CHECK_TIMEOUT_MS
): Promise<OpenedClient> {
  const client = new Client({ name: 'shinsa', version: '1.0.0' });
  const close = async () => {
    try {
      await client.close();
    } catch (error) {
      log.warn('[Extensions] Could not close an MCP connection', {
        transport: definition.transport,
        error: describeError(error),
      });
    }
  };
  let opened: CheckTransport | null = null;
  try {
    opened = createTransport(definition);
    await withTimeout(client.connect(opened.transport), timeoutMs);
    return { client, stderr: opened.stderr, close };
  } catch (error) {
    await close();
    throw new McpConnectError(error, opened?.stderr() ?? '');
  }
}

class McpConnectError extends Error {
  readonly unauthorized: boolean;

  constructor(cause: unknown, stderr: string) {
    const message = describeError(cause);
    super(stderr ? `${message} ${stderr}` : message);
    this.unauthorized = isUnauthorized(cause);
  }
}

export function listToolInfo(tools: { name: string; description?: string | undefined }[]) {
  return tools.map((tool) => ({ name: tool.name, description: clipToolDescription(tool.description) }));
}

function sumToolTokens(tools: unknown[]) {
  return tools.reduce<number>((total, tool) => total + resolveTokenEstimate(JSON.stringify(tool)), 0);
}

export function createServerCheck(timeoutMs = CHECK_TIMEOUT_MS): ServerCheck {
  return async (definition) => {
    let opened: OpenedClient | null = null;
    try {
      opened = await openMcpClient(definition, timeoutMs);
      const listed = await withTimeout(opened.client.listTools(), timeoutMs);
      return {
        state: 'connected',
        error: null,
        tools: listToolInfo(listed.tools),
        tokens: sumToolTokens(listed.tools),
      };
    } catch (error) {
      if (error instanceof McpConnectError ? error.unauthorized : isUnauthorized(error)) {
        return { state: 'needs_sign_in', error: 'The server wants you to sign in.', tools: [], tokens: null };
      }
      return { state: 'failing', error: describeError(error), tools: [], tokens: null };
    } finally {
      await opened?.close();
    }
  };
}
