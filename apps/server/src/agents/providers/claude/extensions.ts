import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { McpDefinition } from '../../../extensions/definitions.ts';
import { resolveDeferredInstructions, type SessionExtensions } from '../../../extensions/index.ts';
import { SHINSA_SKILL_NAMES } from '../instructions.ts';

interface ClaudeExtensions {
  skills: string[] | 'all';
  skillOverrides: Record<string, 'off'>;
  enabledPlugins: Record<string, boolean>;
  servers: Record<string, McpServerConfig>;
  instructions: string | null;
}

export function serializeClaudeServer(definition: McpDefinition): McpServerConfig {
  if (definition.transport === 'stdio') {
    return {
      type: 'stdio',
      command: definition.command ?? '',
      args: definition.args,
      env: definition.env,
    };
  }
  return { type: definition.transport, url: definition.url ?? '', headers: definition.headers };
}

function resolveSkillFiles(extensions: SessionExtensions) {
  const files = extensions.skills.filter((skill) => skill.claudeName === null);
  if (files.length === 0) return null;
  const lines = files.map((skill) => `- \`${skill.path}\`: ${skill.description || skill.name}`);
  return ['## More skills', 'Read these files with a shell command when they apply:', ...lines].join('\n');
}

export function resolveClaudeExtensions(extensions: SessionExtensions | undefined): ClaudeExtensions {
  if (!extensions) {
    return {
      skills: SHINSA_SKILL_NAMES.map((name) => `shinsa:${name}`),
      skillOverrides: {},
      enabledPlugins: {},
      servers: {},
      instructions: null,
    };
  }
  return {
    skills: 'all',
    skillOverrides: Object.fromEntries(extensions.skillsOff.map((name) => [name, 'off' as const])),
    enabledPlugins: extensions.plugins,
    servers: Object.fromEntries(
      extensions.servers.map((server) => [server.claudeName, serializeClaudeServer(server.definition)])
    ),
    instructions:
      [resolveSkillFiles(extensions), resolveDeferredInstructions(extensions)].filter(Boolean).join('\n\n') ||
      null,
  };
}
