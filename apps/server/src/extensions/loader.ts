import { readFileSync } from 'node:fs';
import { DomainError } from '@shinsa/core';
import type { AgentSession } from '../agents/providers/types.ts';
import type { ToolSpec } from '../agents/tools/schema.ts';
import { describeError, log } from '../log/index.ts';
import type { McpDefinition } from './definitions.ts';
import { listToolInfo, type OpenedClient, openMcpClient, withTimeout } from './health.ts';

export interface DeferredServer {
  name: string;
  claudeName: string;
  definition: McpDefinition;
  tools: string[];
  tokens: number | null;
}

export interface DeferredSkill {
  name: string;
  description: string;
  path: string;
}

export interface LoadableExtensions {
  deferred: DeferredServer[];
  deferredSkills: DeferredSkill[];
  loadedNames: string[];
}

type HotLoadSession = Pick<AgentSession, 'loadMcpServers'>;

export type OpenClient = (definition: McpDefinition) => Promise<OpenedClient>;

const HOT_LOAD_TIMEOUT_MS = 20_000;

const TOOL_CALL_TIMEOUT_MS = 120_000;

const NAME = { type: 'string', maxLength: 128 };

function describeServerChoice(server: DeferredServer) {
  if (server.tools.length === 0) return server.name;
  return `${server.name} (${server.tools.length} ${server.tools.length === 1 ? 'tool' : 'tools'})`;
}

function isNameMatch(candidates: string[], wanted: string) {
  const plain = wanted
    .trim()
    .toLowerCase()
    .replace(/^mcp__/, '');
  return candidates.some((candidate) => candidate.toLowerCase() === plain);
}

function serializeContent(content: unknown) {
  if (!Array.isArray(content)) return JSON.stringify(content ?? null);
  return content
    .map((part: { type?: unknown; text?: unknown }) =>
      part.type === 'text' && typeof part.text === 'string' ? part.text : `[${String(part.type)}]`
    )
    .join('\n');
}

export function resolveSkillBody(text: string) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

export class ExtensionLoader {
  readonly #extensions: LoadableExtensions;
  readonly #open: OpenClient;
  readonly #loaded = new Set<string>();
  readonly #loading = new Map<string, Promise<string>>();
  readonly #proxied = new Map<string, OpenedClient>();
  readonly #opened = new Set<OpenedClient>();
  #session: HotLoadSession | null = null;
  #closed = false;

  constructor(extensions: LoadableExtensions, open: OpenClient = openMcpClient) {
    this.#extensions = extensions;
    this.#open = open;
  }

  listSpecs(): ToolSpec[] {
    const { deferred, deferredSkills } = this.#extensions;
    const specs: ToolSpec[] = [];
    if (deferred.length > 0) {
      specs.push(
        {
          name: 'load_mcp_server',
          description: [
            'Load an MCP server Shinsa left out of this run because it has not been used lately.',
            `These can be loaded: ${deferred.map(describeServerChoice).join(', ')}.`,
            'Load one when the task needs it or the human names it. Its tools are listed in the reply.',
          ].join(' '),
          inputSchema: {
            type: 'object',
            properties: { name: { ...NAME, description: 'The server’s name.' } },
            required: ['name'],
          },
        },
        {
          name: 'call_mcp_tool',
          description:
            'Call a tool of a server load_mcp_server connected through Shinsa. Only when its reply says to use this tool.',
          inputSchema: {
            type: 'object',
            properties: {
              server: { ...NAME, description: 'The server’s name.' },
              tool: { ...NAME, description: 'The tool’s name.' },
              arguments: {
                type: 'object',
                description: 'The tool’s arguments, as its schema describes them.',
              },
            },
            required: ['server', 'tool'],
          },
        }
      );
    }
    if (deferredSkills.length > 0) {
      specs.push({
        name: 'load_skill',
        description: [
          'Read a skill Shinsa left out of this run because it has not been used lately.',
          `These can be loaded: ${deferredSkills.map((skill) => skill.name).join(', ')}.`,
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: { name: { ...NAME, description: 'The skill’s name.' } },
          required: ['name'],
        },
      });
    }
    return specs;
  }

  isLoaderTool(name: string) {
    return this.listSpecs().some((spec) => spec.name === name);
  }

  attach(session: HotLoadSession) {
    this.#session = session;
  }

  async handle(name: string, input: Record<string, unknown>) {
    if (name === 'load_mcp_server') return await this.#loadServer(String(input.name ?? ''));
    if (name === 'call_mcp_tool') {
      return await this.#callTool(String(input.server ?? ''), String(input.tool ?? ''), input.arguments);
    }
    return this.#loadSkill(String(input.name ?? ''));
  }

  #findServer(wanted: string) {
    const server = this.#extensions.deferred.find((entry) =>
      isNameMatch([entry.name, entry.claudeName], wanted)
    );
    if (server) return server;
    if (isNameMatch(this.#extensions.loadedNames, wanted)) {
      throw new DomainError('server_loaded', `${wanted} is already loaded in this run. Use its tools.`);
    }
    throw new DomainError(
      'server_not_loadable',
      `There is no MCP server named ${wanted} to load. These can be loaded: ${this.#extensions.deferred.map((entry) => entry.name).join(', ')}. A server turned off in Settings → Integrations stays off.`
    );
  }

  async #loadServer(wanted: string) {
    const server = this.#findServer(wanted);
    if (this.#loaded.has(server.name) || this.#proxied.has(server.name)) {
      return `${server.name} is already loaded in this run.`;
    }
    const loading = this.#loading.get(server.name);
    if (loading) return await loading;
    const load = this.#connect(server).finally(() => {
      this.#loading.delete(server.name);
    });
    this.#loading.set(server.name, load);
    return await load;
  }

  async #connect(server: DeferredServer) {
    const hot = this.#session?.loadMcpServers;
    if (hot) {
      const abandon = new AbortController();
      try {
        const errors = await withTimeout(hot([server], abandon.signal), HOT_LOAD_TIMEOUT_MS);
        const error = errors[server.claudeName] ?? null;
        if (error === null) {
          this.#loaded.add(server.name);
          const tools = server.tools.length > 0 ? ` Its tools: ${server.tools.join(', ')}.` : '';
          return `Loaded ${server.name}. Its tools are available to you now as mcp__${server.claudeName.replaceAll(':', '_')}__<tool>.${tools}`;
        }
        log.warn('[Extensions] A server did not load into the session; connecting through Shinsa', {
          server: server.name,
          error,
        });
      } catch (error) {
        abandon.abort();
        log.warn('[Extensions] Could not load a server into the session; connecting through Shinsa', {
          server: server.name,
          error: describeError(error),
        });
      }
    }
    return this.#proxy(server);
  }

  async #proxy(server: DeferredServer) {
    const opened = await this.#open(server.definition);
    this.#opened.add(opened);
    try {
      const listed = await withTimeout(opened.client.listTools(), HOT_LOAD_TIMEOUT_MS);
      if (this.#closed) throw new Error('This run has ended.');
      this.#proxied.set(server.name, opened);
      const tools = listed.tools.map((tool) => ({
        name: tool.name,
        description: listToolInfo([tool])[0]?.description ?? null,
        inputSchema: tool.inputSchema,
      }));
      return [
        `Connected to ${server.name} through Shinsa. Call its tools with call_mcp_tool, server "${server.name}":`,
        JSON.stringify(tools),
      ].join('\n');
    } catch (error) {
      this.#opened.delete(opened);
      await opened.close();
      throw error;
    }
  }

  async #callTool(serverName: string, tool: string, args: unknown) {
    const opened = this.#proxied.get(serverName);
    if (!opened) {
      throw new DomainError(
        'server_not_connected',
        `${serverName} is not connected through Shinsa. Load it with load_mcp_server first.`
      );
    }
    const result = await withTimeout(
      opened.client.callTool({
        name: tool,
        arguments: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
      }),
      TOOL_CALL_TIMEOUT_MS
    );
    const text = serializeContent(result.content);
    if (result.isError) throw new Error(text || `${tool} failed.`);
    return text;
  }

  #loadSkill(wanted: string) {
    const skill = this.#extensions.deferredSkills.find((entry) => isNameMatch([entry.name], wanted));
    if (!skill) {
      throw new DomainError(
        'skill_not_loadable',
        `There is no skill named ${wanted} to load. These can be loaded: ${this.#extensions.deferredSkills.map((entry) => entry.name).join(', ')}.`
      );
    }
    return resolveSkillBody(readFileSync(skill.path, 'utf8'));
  }

  async close() {
    this.#closed = true;
    const clients = [...this.#opened];
    this.#opened.clear();
    this.#proxied.clear();
    await Promise.all(clients.map((client) => client.close()));
  }
}
