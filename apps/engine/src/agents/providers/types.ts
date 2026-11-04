import {
  type AgentModel,
  type AgentRole,
  type ChatEvent,
  type CompactionMode,
  type ProviderLogin,
  type RunFailure,
  type RunOutcome,
  type RunRole,
  type RunUsage,
  resolveAgentFastMode,
  resolveCompaction,
  resolveFastMode,
  type Settings,
} from '@shinsa/core';
import type { Effect, Scope } from 'effect';
import type { UsageRead } from '../../accounts/usage.ts';
import type { DeferredServer } from '../../extensions/loader/schema.ts';
import type { SessionExtensions } from '../../extensions/session.ts';
import type { ShinsaTools } from '../tools/index.ts';
import type { ClaudeSessionEnded, McpServersRefused } from './claude/session/schema.ts';
import type { ProviderCallFailed } from './schema.ts';

export type ImageStore = (data: string, mediaType: string) => string | null;

export type UsageBaseline = (sessionId: string) => RunUsage | null;

export interface ProviderUsageReading {
  read: UsageRead;
  email: string | null;
  plan: string | null;
}

export interface AgentSessionInput {
  role: RunRole;
  readOnly: boolean;
  cwd: string;
  prompt: string;
  model: string | null;
  resume: string | null;
  fork?: boolean;
  defaultBranch: string;
  tools: ShinsaTools;
  pluginDir: string;
  onSession: (sessionId: string) => void;
  onEntry: (event: ChatEvent) => void;
  storeImage?: ImageStore;
  account?: SessionAccount;
  onActivity?: () => void;
  onProcess?: (pid: number) => void;
  compaction?: CompactionMode;
  fold?: boolean;
  cacheWarm?: boolean;
  fastMode?: boolean;
  usageBaseline?: UsageBaseline;
  extensions?: SessionExtensions;
  announceExtensions?: boolean;
}

interface SessionAccount {
  id: string;
  configDir: string | null;
}

export interface SessionContext {
  usedTokens: number | null;
  maxTokens: number | null;
  cacheExpiresAt: number | null;
  backgroundWork: boolean;
}

export interface AgentSessionResult {
  outcome: RunOutcome;
  summary: string | null;
  failure?: RunFailure | null;
  undelivered?: string[];
  usage?: RunUsage | null;
  context?: SessionContext | null;
  subagentUsage?: { sessionId: string; usage: RunUsage }[];
}

type SteerSource = 'you' | 'shinsa';

export interface AgentSession {
  readonly done: Effect.Effect<AgentSessionResult>;
  readonly steer: (text: string, from?: SteerSource) => Effect.Effect<boolean>;
  readonly cancel: Effect.Effect<void>;
  readonly hasPendingBackgroundWork?: Effect.Effect<boolean>;
  readonly loadMcpServers?: (
    servers: DeferredServer[],
    abandoned: AbortSignal
  ) => Effect.Effect<Record<string, string | null>, ClaudeSessionEnded | McpServersRefused>;
}

export interface CompletionRequest {
  system: string;
  prompt: string;
  model: string;
  fastMode?: boolean;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export interface StructuredRequest extends CompletionRequest {
  schema: JsonSchema;
  timeoutMs?: number;
}

export type SessionArtifactStatus = 'present' | 'missing' | 'empty' | 'unknown';

export interface SessionQuery {
  cwd: string;
  sessionId: string;
}

export interface ProviderCapabilities {
  sessions: { resume: boolean; inspect: boolean; fork: boolean };
  turns: { steering: boolean };
  approvals: boolean;
  planning: { readOnly: boolean };
  contextHandoff: boolean;
  structuredOutput: boolean;
  accounts: boolean;
  compaction: boolean;
  folds: boolean;
  fastMode: boolean;
}

const MINIMAL_CAPABILITIES: ProviderCapabilities = {
  sessions: { resume: false, inspect: false, fork: false },
  turns: { steering: false },
  approvals: false,
  planning: { readOnly: false },
  contextHandoff: false,
  structuredOutput: false,
  accounts: false,
  compaction: false,
  folds: false,
  fastMode: false,
};

export interface ModelSource {
  readonly listModels: Effect.Effect<AgentModel[]>;
}

export interface AgentProvider extends ModelSource {
  readonly id: string;
  readonly label: string;
  readonly capabilities?: ProviderCapabilities;
  readonly startSession: (input: AgentSessionInput) => Effect.Effect<AgentSession, never, Scope.Scope>;
  readonly compactSession?: (
    input: Omit<AgentSessionInput, 'prompt'>
  ) => Effect.Effect<AgentSession, never, Scope.Scope>;
  readonly inspectSession?: (query: SessionQuery) => Effect.Effect<SessionArtifactStatus>;
  readonly complete: (request: CompletionRequest) => Effect.Effect<string | null, ProviderCallFailed>;
  readonly completeStructured?: (request: StructuredRequest) => Effect.Effect<unknown, ProviderCallFailed>;
  readonly readLogin?: Effect.Effect<ProviderLogin>;
  readonly readUsage?: Effect.Effect<ProviderUsageReading, ProviderCallFailed>;
}

export type SessionStarter = AgentProvider['startSession'];

export function resolveCapabilities(provider: Pick<AgentProvider, 'capabilities'>): ProviderCapabilities {
  return provider.capabilities ?? MINIMAL_CAPABILITIES;
}

export function resolveSessionOptions(
  settings: Settings,
  provider: Pick<AgentProvider, 'capabilities'>,
  role: AgentRole | null = null
): Pick<AgentSessionInput, 'compaction' | 'fastMode'> {
  const fast = role === null ? resolveFastMode(settings) : resolveAgentFastMode(settings, role);
  return {
    compaction: resolveCompaction(settings),
    fastMode: fast && resolveCapabilities(provider).fastMode,
  };
}
