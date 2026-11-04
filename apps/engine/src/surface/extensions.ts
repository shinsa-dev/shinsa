import {
  DomainError,
  type ExtensionsSnapshot,
  type McpServerSummary,
  type PluginSummary,
  type SkillSummary,
} from '@shinsa/core';
import { Effect } from 'effect';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec, Values } from './fields.ts';
import type { SurfaceFailure } from './schema.ts';
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

function findEntry<T extends { id: string; name: string }>(
  entries: readonly T[],
  reference: string,
  kind: string
) {
  const found =
    entries.find((entry) => entry.id === reference) ?? entries.find((entry) => entry.name === reference);
  return found
    ? Effect.succeed(found)
    : Effect.fail(
        new DomainError({ code: `${kind}_not_found`, message: `There is no ${kind} named ${reference}.` })
      );
}

const findServer = Effect.fn('Surface.mcpServer')(function* (client: SurfaceClient, values: Values) {
  const snapshot = yield* client.api.extensions.snapshot();
  return yield* findEntry(snapshot.servers, readValue(values, 'server'), 'server');
});

function defineSwitch(
  group: string,
  enabled: boolean,
  field: FieldSpec,
  act: (client: SurfaceClient, values: Values, enabled: boolean) => Effect.Effect<string, SurfaceFailure>
) {
  return defineAction({
    path: [group, enabled ? 'on' : 'off'],
    summary: `Turn ${field.name === 'server' ? 'an MCP server' : `a ${field.name}`} ${enabled ? 'on' : 'off'} for agents.`,
    humanOnly: true,
    fields: [field],
    act: (client, values) =>
      Effect.map(act(client, values, enabled), (text) => ({ data: { ok: true }, text })),
  });
}

const switchServer = Effect.fn('Surface.switchServer')(function* (
  client: SurfaceClient,
  values: Values,
  enabled: boolean
) {
  const server = yield* findServer(client, values);
  yield* client.api.extensions.chooseServer({ payload: { serverId: server.id, enabled } });
  return `Turned ${server.name} ${enabled ? 'on' : 'off'} for agents.`;
});

const switchSkill = Effect.fn('Surface.switchSkill')(function* (
  client: SurfaceClient,
  values: Values,
  enabled: boolean
) {
  const snapshot = yield* client.api.extensions.snapshot();
  const skill = yield* findEntry(snapshot.skills, readValue(values, 'skill'), 'skill');
  yield* client.api.extensions.chooseSkill({ payload: { skillId: skill.id, enabled } });
  return `Turned the ${skill.name} skill ${enabled ? 'on' : 'off'}.`;
});

const switchPlugin = Effect.fn('Surface.switchPlugin')(function* (
  client: SurfaceClient,
  values: Values,
  enabled: boolean
) {
  const snapshot = yield* client.api.extensions.snapshot();
  const plugin = yield* findEntry(snapshot.plugins, readValue(values, 'plugin'), 'plugin');
  yield* client.api.extensions.choosePlugin({ payload: { pluginId: plugin.id, enabled } });
  return `Turned the ${plugin.name} plugin ${enabled ? 'on' : 'off'}.`;
});

export const EXTENSION_SPECS: SurfaceSpec[] = [
  defineRead({
    path: ['mcp', 'list'],
    summary: 'List the MCP servers agents can load, with their health and roughly what their tools cost.',
    fields: [],
    read: (_values, client) => client.api.extensions.snapshot(),
    format: formatServers,
  }),
  defineAction({
    path: ['mcp', 'check'],
    summary: 'Connect to every MCP server that is on, or one, and list its tools.',
    humanOnly: true,
    fields: [{ ...SERVER_FIELD, required: false }],
    act: Effect.fn('Surface.mcpCheck')(function* (client, values) {
      if (!readValue(values, 'server')) {
        const data = yield* client.api.extensions.check({ payload: {} });
        return { data, text: formatServers(data) };
      }
      const server = yield* findServer(client, values);
      const data = yield* client.api.extensions.check({ payload: { serverId: server.id } });
      return { data, text: formatServers(data) };
    }),
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
    act: Effect.fn('Surface.mcpAdd')(function* (client, values) {
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
      const data = yield* client.api.extensions.addServer({ payload: { server } });
      return { data, text: `Added ${server.name}. Agents load it from their next run.` };
    }),
  }),
  defineAction({
    path: ['mcp', 'remove'],
    summary: 'Remove an MCP server you added in Shinsa.',
    humanOnly: true,
    fields: [SERVER_FIELD],
    act: Effect.fn('Surface.mcpRemove')(function* (client, values) {
      const server = yield* findServer(client, values);
      const data = yield* client.api.extensions.removeServer({
        payload: {
          serverId: server.id,
        },
      });
      return { data, text: `Removed ${server.name}.` };
    }),
  }),
  defineSwitch('mcp', true, SERVER_FIELD, switchServer),
  defineSwitch('mcp', false, SERVER_FIELD, switchServer),
  defineAction({
    path: ['mcp', 'sign-in'],
    summary: 'Sign in to a remote MCP server in the browser; Shinsa keeps the sign-in.',
    humanOnly: true,
    fields: [SERVER_FIELD],
    act: Effect.fn('Surface.mcpSignIn')(function* (client, values) {
      const server = yield* findServer(client, values);
      const data = yield* client.api.extensions.signIn({
        payload: {
          serverId: server.id,
        },
      });
      return {
        data,
        text: data.authorizationUrl
          ? `Open this page to sign in to ${server.name}:\n${data.authorizationUrl}`
          : `Already signed in to ${server.name}.`,
      };
    }),
  }),
  defineAction({
    path: ['mcp', 'sign-out'],
    summary: 'Forget Shinsa’s sign-in to a remote MCP server.',
    humanOnly: true,
    fields: [SERVER_FIELD],
    act: Effect.fn('Surface.mcpSignOut')(function* (client, values) {
      const server = yield* findServer(client, values);
      const data = yield* client.api.extensions.signOut({
        payload: {
          serverId: server.id,
        },
      });
      return { data, text: `Signed out of ${server.name}.` };
    }),
  }),
  defineRead({
    path: ['skills', 'list'],
    summary: 'List the skills agents can load, on or off, with roughly what each costs.',
    fields: [],
    read: (_values, client) => client.api.extensions.snapshot(),
    format: formatSkills,
  }),
  defineSwitch('skills', true, SKILL_FIELD, switchSkill),
  defineSwitch('skills', false, SKILL_FIELD, switchSkill),
  defineRead({
    path: ['plugins', 'list'],
    summary: 'List the Claude Code plugins agents can load, with what each brings.',
    fields: [],
    read: (_values, client) => client.api.extensions.snapshot(),
    format: formatPlugins,
  }),
  defineSwitch('plugins', true, PLUGIN_FIELD, switchPlugin),
  defineSwitch('plugins', false, PLUGIN_FIELD, switchPlugin),
];
