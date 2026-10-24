import {
  DomainError,
  type ExtensionsSnapshot,
  type McpServerSummary,
  type PluginSummary,
  type SkillSummary,
} from '@shinsa/core';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec, Values } from './fields.ts';
import { defineAction, defineRead, readValue, type SurfaceSpec } from './spec.ts';

const SERVER_FIELD: FieldSpec = {
  name: 'server',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The MCP server (its id or name).',
};

const SKILL_FIELD: FieldSpec = {
  name: 'skill',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The skill (its id or name).',
};

const PLUGIN_FIELD: FieldSpec = {
  name: 'plugin',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The plugin (its id or name).',
};

function describeTokens(tokens: number | null) {
  return tokens === null ? '' : `  ~${tokens} tokens`;
}

function describeServer(server: McpServerSummary) {
  const state = server.enabled ? server.status.state.replace('_', ' ') : 'off';
  const target = server.url ?? [server.command, ...server.args].join(' ');
  const tools = server.status.tools.length > 0 ? `  ${server.status.tools.length} tools` : '';
  return `${server.id}  ${state}  ${server.origin}  ${target}${tools}${describeTokens(server.status.tokens)}`;
}

function describeSkill(skill: SkillSummary) {
  return `${skill.id}  ${skill.enabled ? 'on' : 'off'}  ${skill.origin}${describeTokens(skill.tokens)}`;
}

function describePlugin(plugin: PluginSummary) {
  return `${plugin.id}  ${plugin.enabled ? 'on' : 'off'}  ${plugin.skills} skills, ${plugin.agents} agents, ${plugin.servers} servers${describeTokens(plugin.tokens)}`;
}

function formatServers(snapshot: ExtensionsSnapshot) {
  const lines = [...snapshot.servers.map(describeServer), ...snapshot.problems];
  return lines.length === 0 ? 'No MCP servers.' : lines.join('\n');
}

function formatSkills(snapshot: ExtensionsSnapshot) {
  return snapshot.skills.length === 0 ? 'No skills.' : snapshot.skills.map(describeSkill).join('\n');
}

function formatPlugins(snapshot: ExtensionsSnapshot) {
  return snapshot.plugins.length === 0 ? 'No plugins.' : snapshot.plugins.map(describePlugin).join('\n');
}

function findEntry<T extends { id: string; name: string }>(entries: T[], reference: string, kind: string) {
  const found =
    entries.find((entry) => entry.id === reference) ?? entries.find((entry) => entry.name === reference);
  if (!found) throw new DomainError(`${kind}_not_found`, `There is no ${kind} named ${reference}.`);
  return found;
}

async function findServer(client: SurfaceClient, values: Values) {
  const snapshot = await client.read<ExtensionsSnapshot>('/api/extensions');
  return findEntry(snapshot.servers, readValue(values, 'server'), 'server');
}

function defineSwitch(
  group: string,
  enabled: boolean,
  field: FieldSpec,
  act: (client: SurfaceClient, values: Values, enabled: boolean) => Promise<string>
) {
  return defineAction({
    path: [group, enabled ? 'on' : 'off'],
    summary: `Turn ${field.name === 'server' ? 'an MCP server' : `a ${field.name}`} ${enabled ? 'on' : 'off'} for agents.`,
    humanOnly: true,
    fields: [field],
    act: async (client, values) => {
      const text = await act(client, values, enabled);
      return { data: { ok: true }, text };
    },
  });
}

async function switchServer(client: SurfaceClient, values: Values, enabled: boolean) {
  const server = await findServer(client, values);
  await client.post<ExtensionsSnapshot>('/api/extensions/servers/choose', { serverId: server.id, enabled });
  return `Turned ${server.name} ${enabled ? 'on' : 'off'} for agents.`;
}

async function switchSkill(client: SurfaceClient, values: Values, enabled: boolean) {
  const snapshot = await client.read<ExtensionsSnapshot>('/api/extensions');
  const skill = findEntry(snapshot.skills, readValue(values, 'skill'), 'skill');
  await client.post<ExtensionsSnapshot>('/api/extensions/skills/choose', { skillId: skill.id, enabled });
  return `Turned the ${skill.name} skill ${enabled ? 'on' : 'off'}.`;
}

async function switchPlugin(client: SurfaceClient, values: Values, enabled: boolean) {
  const snapshot = await client.read<ExtensionsSnapshot>('/api/extensions');
  const plugin = findEntry(snapshot.plugins, readValue(values, 'plugin'), 'plugin');
  await client.post<ExtensionsSnapshot>('/api/extensions/plugins/choose', { pluginId: plugin.id, enabled });
  return `Turned the ${plugin.name} plugin ${enabled ? 'on' : 'off'}.`;
}

export const EXTENSION_SPECS: SurfaceSpec[] = [
  defineRead<ExtensionsSnapshot>({
    path: ['mcp', 'list'],
    summary: 'List the MCP servers agents can load, with their health and roughly what their tools cost.',
    fields: [],
    request: () => '/api/extensions',
    format: formatServers,
  }),
  defineAction({
    path: ['mcp', 'check'],
    summary: 'Connect to every MCP server that is on, or one, and list its tools.',
    humanOnly: true,
    fields: [{ ...SERVER_FIELD, required: false }],
    act: async (client, values) => {
      let body = {};
      if (readValue(values, 'server')) body = { serverId: (await findServer(client, values)).id };
      const data = await client.post<ExtensionsSnapshot>('/api/extensions/check', body);
      return { data, text: formatServers(data) };
    },
  }),
  defineAction({
    path: ['mcp', 'add'],
    summary: 'Add an MCP server agents load everywhere: a command on this machine, or an HTTP address.',
    humanOnly: true,
    fields: [
      { name: 'name', kind: 'text', positional: 'one', required: true, description: 'Its name.' },
      { name: 'url', kind: 'text', description: 'Its http or https address, for a remote server.' },
      { name: 'sse', kind: 'boolean', description: 'The address speaks SSE rather than streamable HTTP.' },
      {
        name: 'command',
        kind: 'text',
        positional: 'rest',
        description: 'The command that starts it, with its arguments (after -- when one starts with --).',
      },
    ],
    act: async (client, values) => {
      const words = (readValue(values, 'command') || '').split(' ').filter(Boolean);
      const url = readValue(values, 'url');
      const server = url
        ? { name: readValue(values, 'name'), transport: values.sse ? 'sse' : 'http', url }
        : {
            name: readValue(values, 'name'),
            transport: 'stdio',
            command: words[0] ?? '',
            args: words.slice(1),
          };
      const data = await client.post<ExtensionsSnapshot>('/api/extensions/servers/add', { server });
      return { data, text: `Added ${server.name}. Agents load it from their next run.` };
    },
  }),
  defineAction({
    path: ['mcp', 'remove'],
    summary: 'Remove an MCP server you added in Shinsa.',
    humanOnly: true,
    fields: [SERVER_FIELD],
    act: async (client, values) => {
      const server = await findServer(client, values);
      const data = await client.post<ExtensionsSnapshot>('/api/extensions/servers/remove', {
        serverId: server.id,
      });
      return { data, text: `Removed ${server.name}.` };
    },
  }),
  defineSwitch('mcp', true, SERVER_FIELD, switchServer),
  defineSwitch('mcp', false, SERVER_FIELD, switchServer),
  defineAction({
    path: ['mcp', 'sign-in'],
    summary: 'Sign in to a remote MCP server in the browser; Shinsa keeps the sign-in.',
    humanOnly: true,
    fields: [SERVER_FIELD],
    act: async (client, values) => {
      const server = await findServer(client, values);
      const data = await client.post<{ authorizationUrl: string | null }>('/api/extensions/servers/sign-in', {
        serverId: server.id,
      });
      return {
        data,
        text: data.authorizationUrl
          ? `Open this page to sign in to ${server.name}:\n${data.authorizationUrl}`
          : `Already signed in to ${server.name}.`,
      };
    },
  }),
  defineAction({
    path: ['mcp', 'sign-out'],
    summary: 'Forget Shinsa’s sign-in to a remote MCP server.',
    humanOnly: true,
    fields: [SERVER_FIELD],
    act: async (client, values) => {
      const server = await findServer(client, values);
      const data = await client.post<ExtensionsSnapshot>('/api/extensions/servers/sign-out', {
        serverId: server.id,
      });
      return { data, text: `Signed out of ${server.name}.` };
    },
  }),
  defineRead<ExtensionsSnapshot>({
    path: ['skills', 'list'],
    summary: 'List the skills agents can load, on or off, with roughly what each costs.',
    fields: [],
    request: () => '/api/extensions',
    format: formatSkills,
  }),
  defineSwitch('skills', true, SKILL_FIELD, switchSkill),
  defineSwitch('skills', false, SKILL_FIELD, switchSkill),
  defineRead<ExtensionsSnapshot>({
    path: ['plugins', 'list'],
    summary: 'List the Claude Code plugins agents can load, with what each brings.',
    fields: [],
    request: () => '/api/extensions',
    format: formatPlugins,
  }),
  defineSwitch('plugins', true, PLUGIN_FIELD, switchPlugin),
  defineSwitch('plugins', false, PLUGIN_FIELD, switchPlugin),
];
