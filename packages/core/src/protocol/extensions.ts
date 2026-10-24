import { DAY_MS } from '../domain/time.ts';

export type McpTransport = 'stdio' | 'http' | 'sse';

export type McpSource = 'shinsa' | 'claude' | 'claude_project' | 'project' | 'codex' | 'plugin';

export type ExtensionScope =
  | { kind: 'everywhere' }
  | { kind: 'project'; project: string }
  | { kind: 'repo'; path: string };

export type McpStatusState = 'connected' | 'needs_sign_in' | 'failing' | 'unchecked';

export interface McpToolInfo {
  name: string;
  description: string | null;
}

export interface McpServerStatus {
  state: McpStatusState;
  error: string | null;
  checkedAt: number | null;
  tools: McpToolInfo[];
  tokens: number | null;
}

export interface McpServerPlace {
  id: string;
  source: McpSource;
  origin: string;
  scope: ExtensionScope;
  enabled: boolean;
}

export interface McpServerSummary {
  id: string;
  name: string;
  source: McpSource;
  origin: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
  enabled: boolean;
  scope: ExtensionScope;
  editable: boolean;
  shadowedBy: string | null;
  signedIn: boolean;
  plugin: string | null;
  status: McpServerStatus;
  definedIn: McpServerPlace[];
  lastUsedAt: number | null;
  deferred: boolean;
}

export type SkillSource = 'shinsa' | 'user' | 'plugin' | 'project' | 'codex';

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  origin: string;
  plugin: string | null;
  repoPath: string | null;
  enabled: boolean;
  tokens: number;
  lastUsedAt: number | null;
  deferred: boolean;
}

export interface PluginSummary {
  id: string;
  name: string;
  origin: string;
  enabled: boolean;
  skills: number;
  agents: number;
  commands: number;
  servers: number;
  hooks: boolean;
  tokens: number;
}

export interface ContextOptimizer {
  enabled: boolean;
  days: number;
  skills: boolean;
}

export interface ExtensionUsageRead {
  readAt: number | null;
  since: number | null;
}

export interface ExtensionsSnapshot {
  servers: McpServerSummary[];
  skills: SkillSummary[];
  plugins: PluginSummary[];
  problems: string[];
  optimizer: ContextOptimizer;
  usage: ExtensionUsageRead;
}

export interface LoadedExtension {
  name: string;
  tokens: number | null;
}

export interface LoadedExtensions {
  servers: LoadedExtension[];
  skills: LoadedExtension[];
  plugins: LoadedExtension[];
  deferred?: LoadedExtension[];
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  scope?: ExtensionScope;
  enabled?: boolean;
}

export interface ExtensionPlace {
  repoPath: string | null;
  project: string | null;
}

export const MCP_SIGN_IN_CHANNEL = 'shinsa-mcp';

export function resolveTokenEstimate(text: string) {
  return Math.ceil(text.length / 4);
}

export function sumLoadedTokens(loaded: LoadedExtensions) {
  return [...loaded.servers, ...loaded.skills, ...loaded.plugins].reduce(
    (total, item) => total + (item.tokens ?? 0),
    0
  );
}

export const MCP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isScopeMatch(scope: ExtensionScope, place: ExtensionPlace) {
  if (scope.kind === 'everywhere') return true;
  if (scope.kind === 'project') return place.project === scope.project;
  return place.repoPath === scope.path;
}

export const OPTIMIZER_LIMITS = { minDays: 1, maxDays: 365, defaultDays: 14 } as const;

export function createContextOptimizer(): ContextOptimizer {
  return { enabled: true, days: OPTIMIZER_LIMITS.defaultDays, skills: true };
}

export interface UsageFacts {
  lastUsedAt: number | null;
  firstSeenAt: number | null;
}

export function resolveIdleDays(facts: UsageFacts, now: number) {
  const since = facts.lastUsedAt ?? facts.firstSeenAt;
  if (since === null) return null;
  return Math.max(0, Math.floor((now - since) / DAY_MS));
}

export function isUnused(facts: UsageFacts, now: number, days: number) {
  const idle = resolveIdleDays(facts, now);
  return idle !== null && idle >= days;
}
