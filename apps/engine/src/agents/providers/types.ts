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
import type { UsageRead } from '../../accounts/usage.ts';
import type { SessionExtensions } from '../../extensions/index.ts';
import type { DeferredServer } from '../../extensions/loader.ts';
import type { ShinsaTools } from '../tools/index.ts';

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
  done: Promise<AgentSessionResult>;
  steer: (text: string, from?: SteerSource) => boolean;
  cancel: () => Promise<void>;
  hasPendingBackgroundWork?: () => boolean;
  loadMcpServers?: (
    servers: DeferredServer[],
    abandoned: AbortSignal
  ) => Promise<Record<string, string | null>>;
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
  listModels: () => Promise<AgentModel[]>;
}

export interface AgentProvider extends ModelSource {
  id: string;
  label: string;
  capabilities?: ProviderCapabilities;
  startSession: (input: AgentSessionInput) => AgentSession;
  compactSession?: (input: Omit<AgentSessionInput, 'prompt'>) => AgentSession;
  inspectSession?: (query: SessionQuery) => Promise<SessionArtifactStatus>;
  complete: (request: CompletionRequest) => Promise<string | null>;
  completeStructured?: (request: StructuredRequest) => Promise<unknown>;
  readLogin?: () => Promise<ProviderLogin>;
  readUsage?: () => Promise<ProviderUsageReading>;
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
