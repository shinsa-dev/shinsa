import type { ToolSpec } from '../../agents/tools/schema.ts';
import {
  type DeferredServer,
  LOADER_FILLER_WORDS,
  LOADER_NAME_FIELD,
  type LoadableExtensions,
} from './schema.ts';

function resolvePlainName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/^mcp__/, '');
}

function listNameWords(name: string) {
  return resolvePlainName(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '' && !LOADER_FILLER_WORDS.has(word));
}

function isExactName(candidates: string[], wanted: string) {
  const plain = resolvePlainName(wanted);
  return candidates.some((candidate) => candidate.toLowerCase() === plain);
}

function isLooseName(candidates: string[], wanted: string) {
  const words = new Set(listNameWords(wanted));
  return candidates.some((candidate) => {
    const own = listNameWords(candidate);
    return own.length > 0 && own.every((word) => words.has(word));
  });
}

export function selectByName<T>(entries: T[], names: (entry: T) => string[], wanted: string): T | null {
  const exact = entries.find((entry) => isExactName(names(entry), wanted));
  if (exact) return exact;
  const loose = entries.filter((entry) => isLooseName(names(entry), wanted));
  return loose.length === 1 ? (loose[0] ?? null) : null;
}

export function describeServerChoice(server: DeferredServer) {
  if (server.tools.length === 0) return server.name;
  return `${server.name} (${server.tools.length} ${server.tools.length === 1 ? 'tool' : 'tools'})`;
}

export function serializeContent(content: unknown) {
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

export function listLoaderSpecs(extensions: Pick<LoadableExtensions, 'deferred' | 'deferredSkills'>) {
  const { deferred, deferredSkills } = extensions;
  const specs: ToolSpec[] = [];
  if (deferred.length > 0) {
    specs.push(
      {
        name: 'load_mcp_server',
        description: [
          'Load an MCP server Shinsa left out of this run because it has not been used lately.',
          `These can be loaded: ${deferred.map(describeServerChoice).join(', ')}.`,
          'Load one when the task needs it or the human names it, in any form (`maple`, “the Maple MCP”). Its tools are listed in the reply.',
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: { name: { ...LOADER_NAME_FIELD, description: 'The server’s name.' } },
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
            server: { ...LOADER_NAME_FIELD, description: 'The server’s name.' },
            tool: { ...LOADER_NAME_FIELD, description: 'The tool’s name.' },
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
        'Load one when the task needs it or the human names it, in any form.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: { name: { ...LOADER_NAME_FIELD, description: 'The skill’s name.' } },
        required: ['name'],
      },
    });
  }
  return specs;
}
