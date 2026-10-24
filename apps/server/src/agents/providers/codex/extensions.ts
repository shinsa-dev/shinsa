import type { McpDefinition } from '../../../extensions/definitions.ts';
import type { SessionExtensions } from '../../../extensions/index.ts';

type Params = Record<string, unknown>;

function serializeServer(definition: McpDefinition): Params {
  if (definition.transport === 'stdio') {
    return {
      command: definition.command,
      args: definition.args,
      env: definition.env,
      ...(definition.cwd ? { cwd: definition.cwd } : {}),
    };
  }
  return { url: definition.url, http_headers: definition.headers };
}

export function resolveCodexServerConfig(extensions: SessionExtensions | undefined): Params {
  if (!extensions) return {};
  return {
    ...Object.fromEntries(extensions.codexServersOff.map((name) => [`mcp_servers.${name}.enabled`, false])),
    ...Object.fromEntries(
      extensions.servers.map((server) => [`mcp_servers.${server.name}`, serializeServer(server.definition)])
    ),
  };
}

export function resolveCodexSkillInstructions(extensions: SessionExtensions) {
  const skills = extensions.skills.filter((skill) => skill.source !== 'codex');
  if (skills.length === 0) return null;
  const lines = skills.map((skill) => `- \`${skill.path}\`: ${skill.description || skill.name}`);
  return ['## Skills', 'Read these files with a shell command when they apply:', ...lines].join('\n');
}
