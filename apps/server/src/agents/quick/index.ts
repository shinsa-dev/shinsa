import {
  type FastModeAvailability,
  resolveAgentFastMode,
  resolveAgentModel,
  resolveAgentProvider,
  type Settings,
} from '@shinsa/core';
import { describeError, log } from '../../log/index.ts';
import {
  type AgentProvider,
  type JsonSchema,
  type ProviderRegistry,
  resolveCapabilities,
} from '../providers/index.ts';

export type QuickJson = <T>(system: string, prompt: string, schema?: JsonSchema) => Promise<T | null>;

type QuickMode = 'structured' | 'text';

interface QuickFailure {
  provider: string;
  mode: QuickMode;
  reason: string;
}

interface QuickResult<T> {
  value: T | null;
  failures: QuickFailure[];
}

export interface QuickRequest<T> {
  task: string;
  system: string;
  prompt: string;
  schema: JsonSchema | null;
  parse: (value: unknown) => T | null;
  model: string | ((provider: string) => string);
  timeoutMs?: number;
  fastMode?: boolean;
  readFastMode?: FastModeReader;
}

export type FastModeReader = (provider: string) => Promise<FastModeAvailability>;

const JSON_ONLY = 'Answer with one JSON object and nothing else.';

function parseCandidate(candidate: string | undefined) {
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

export function parseJsonObject<T>(text: string | null): T | null {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text)?.[1];
  const parsed = parseCandidate(fenced) ?? parseCandidate(/\{[\s\S]*\}/.exec(text)?.[0]);
  return parsed as T | null;
}

function listModes(provider: AgentProvider, schema: JsonSchema | null): QuickMode[] {
  const structured =
    schema !== null && resolveCapabilities(provider).structuredOutput && provider.completeStructured;
  return structured ? ['structured', 'text'] : ['text'];
}

function resolveTextSystem(system: string, schema: JsonSchema | null) {
  if (!schema) return `${system}\n${JSON_ONLY}`;
  return `${system}\n${JSON_ONLY}\nIt must match this JSON schema:\n${JSON.stringify(schema)}`;
}

function resolveQuickModel<T>(request: QuickRequest<T>, provider: AgentProvider) {
  return typeof request.model === 'string' ? request.model : request.model(provider.id);
}

async function resolveQuickFastMode<T>(provider: AgentProvider, request: QuickRequest<T>) {
  if (request.fastMode !== true || !resolveCapabilities(provider).fastMode) return false;
  if (!request.readFastMode) return true;
  return (await request.readFastMode(provider.id)) === 'available';
}

async function requestAnswer<T>(provider: AgentProvider, mode: QuickMode, request: QuickRequest<T>) {
  const model = resolveQuickModel(request, provider);
  const fastMode = await resolveQuickFastMode(provider, request);
  if (mode === 'structured' && request.schema && provider.completeStructured) {
    return provider.completeStructured({
      system: request.system,
      prompt: request.prompt,
      model,
      fastMode,
      schema: request.schema,
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    });
  }
  const text = await provider.complete({
    system: resolveTextSystem(request.system, request.schema),
    prompt: request.prompt,
    model,
    fastMode,
  });
  return parseJsonObject<unknown>(text);
}

async function requestAttempt<T>(provider: AgentProvider, mode: QuickMode, request: QuickRequest<T>) {
  const failure = (reason: string): { value: null; failure: QuickFailure } => ({
    value: null,
    failure: { provider: provider.id, mode, reason },
  });
  try {
    const raw = await requestAnswer(provider, mode, request);
    if (raw === null || raw === undefined)
      return failure(`${provider.label} returned no result for ${request.task}.`);
    const value = request.parse(raw);
    if (value === null) return failure(`${provider.label} returned invalid output for ${request.task}.`);
    return { value, failure: null };
  } catch (error) {
    return failure(`${provider.label} failed ${request.task}: ${describeError(error)}`);
  }
}

export async function requestQuickStructured<T>(
  request: QuickRequest<T>,
  providers: AgentProvider[]
): Promise<QuickResult<T>> {
  if (Bun.env.SHINSA_QUICK === 'off') return { value: null, failures: [] };
  const failures: QuickFailure[] = [];
  for (const provider of providers) {
    for (const mode of listModes(provider, request.schema)) {
      const attempt = await requestAttempt(provider, mode, request);
      if (attempt.failure === null) return { value: attempt.value, failures };
      failures.push(attempt.failure);
    }
  }
  if (failures.length > 0)
    log.warn('[Quick] Every provider failed; using the fallback', { task: request.task, failures });
  return { value: null, failures };
}

function parseObject<T>(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as T) : null;
}

function listQuickProviders(registry: ProviderRegistry, preferred: string) {
  const providers = registry.list();
  return [
    ...providers.filter((provider) => provider.id === preferred),
    ...providers.filter((provider) => provider.id !== preferred),
  ];
}

function createQuickJson(
  registry: ProviderRegistry,
  readSettings: () => Settings,
  role: 'classifier' | 'writer',
  readFastMode: FastModeReader | undefined
): QuickJson {
  return async <T>(system: string, prompt: string, schema?: JsonSchema) => {
    const settings = readSettings();
    const result = await requestQuickStructured<T>(
      {
        task: 'a quick answer',
        system,
        prompt,
        schema: schema ?? null,
        parse: parseObject,
        model: (provider) => resolveAgentModel(settings, role, provider),
        fastMode: resolveAgentFastMode(settings, role),
        ...(readFastMode ? { readFastMode } : {}),
      },
      listQuickProviders(registry, resolveAgentProvider(settings, role))
    );
    return result.value;
  };
}

export function createQuickCalls(
  registry: ProviderRegistry,
  readSettings: () => Settings,
  readFastMode?: FastModeReader
) {
  return {
    classify: createQuickJson(registry, readSettings, 'classifier', readFastMode),
    write: createQuickJson(registry, readSettings, 'writer', readFastMode),
  };
}
