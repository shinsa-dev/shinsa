import type {
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  Options,
  SDKResultMessage,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { type ChatNotice, isReadOnlyRole, isTaskSessionRole, type RunRole } from '@shinsa/core';
import type { resolveAccountEnv } from '../../../../accounts/paths.ts';
import type { ShinsaTools } from '../../../tools/index.ts';
import type { AgentSessionInput } from '../../types.ts';
import type { TurnVerdict } from '../classify.ts';
import type { resolveClaudeExtensions } from '../extensions.ts';
import { guardCommand, listReadOnlyHooks } from '../guard.ts';
import { EDIT_TOOLS, SUMMARY_LIMIT } from './schema.ts';

interface QueryRoute {
  env: Record<string, string>;
  autoCompact: boolean;
}

interface QueryProcess {
  options: { pathToClaudeCodeExecutable: string; env: Record<string, string | undefined> };
}

export function serializeToolServer(tools: ShinsaTools): McpSdkServerConfigWithInstance {
  return {
    type: 'sdk',
    name: tools.name,
    instance: tools.server as unknown as McpSdkServerConfigWithInstance['instance'],
  };
}

function resolveDisallowedTools(role: RunRole) {
  return isReadOnlyRole(role) && !isTaskSessionRole(role) ? EDIT_TOOLS : [];
}

export function resolveFastModeNotice(message: SDKSystemMessage): ChatNotice | null {
  const state = message.fast_mode_state;
  if (state === undefined || state === 'on') return null;
  return {
    kind: 'fast_mode',
    status: state === 'cooldown' ? 'cooldown' : 'unavailable',
    reason: message.fast_mode_disabled_reason ?? null,
  };
}

export function resolveSummary(message: SDKResultMessage, verdict: TurnVerdict) {
  if (verdict.failure) return verdict.failure.message;
  return message.subtype === 'success' ? message.result.slice(0, SUMMARY_LIMIT) : null;
}

export function removeServers(
  connected: Readonly<Record<string, McpServerConfig>>,
  names: readonly string[]
) {
  return Object.fromEntries(Object.entries(connected).filter(([name]) => !names.includes(name)));
}

export function resolveQueryOptions(
  input: AgentSessionInput,
  extensions: ReturnType<typeof resolveClaudeExtensions>,
  appended: string,
  route: QueryRoute,
  process: QueryProcess,
  accountEnv: ReturnType<typeof resolveAccountEnv>,
  spawn: Options['spawnClaudeCodeProcess']
): Options {
  return {
    cwd: input.cwd,
    ...(input.model ? { model: input.model } : {}),
    ...(input.resume ? { resume: input.resume, ...(input.fork ? { forkSession: true } : {}) } : {}),
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    mcpServers: { [input.tools.name]: serializeToolServer(input.tools) },
    disallowedTools: resolveDisallowedTools(input.role),
    strictMcpConfig: true,
    skills: extensions.skills,
    settingSources: ['user', 'project', 'local'],
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: appended,
      excludeDynamicSections: true,
      snapshot: true,
    },
    plugins: [{ type: 'local', path: input.pluginDir }],
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [guardCommand(input.defaultBranch)] },
        ...(input.readOnly && resolveDisallowedTools(input.role).length === 0
          ? listReadOnlyHooks(input.role)
          : []),
      ],
    },
    forwardSubagentText: true,
    settings: {
      ...(Object.keys(extensions.enabledPlugins).length > 0
        ? { enabledPlugins: extensions.enabledPlugins }
        : {}),
      ...(Object.keys(extensions.skillOverrides).length > 0
        ? { skillOverrides: extensions.skillOverrides }
        : {}),
      fastMode: input.fastMode === true,
      autoCompactEnabled: route.autoCompact,
      env: route.env,
    },
    ...process.options,
    spawnClaudeCodeProcess: spawn,
    env: { ...process.options.env, ...accountEnv, ...route.env },
  };
}
