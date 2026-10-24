import type { ModelInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { type AgentModel, KNOWN_AGENT_MODELS, resolveModelFamily, resolveModelLabel } from '@shinsa/core';
import { describeError, log } from '../../../log/index.ts';
import { CLAUDE_RUNTIME, type ClaudeRuntime, resolveClaudeProcess } from './sdk.ts';

const CATALOG_TIMEOUT_MS = 20_000;

export function resolveModels(rows: ModelInfo[]): AgentModel[] {
  const families = new Map<string, AgentModel>();
  for (const row of rows) {
    const wireId = row.resolvedModel ?? row.value;
    const family = resolveModelFamily(wireId);
    if (family === 'default' || families.has(family)) continue;
    families.set(family, { id: family, label: resolveModelLabel(wireId), description: row.description });
  }
  return [...families.values()];
}

function silence(): AsyncIterable<SDKUserMessage> {
  return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) };
}

async function requestSdkModels(runtime: ClaudeRuntime, timeoutMs: number) {
  const process = await resolveClaudeProcess(runtime.resolveExecutable);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const session = runtime.runQuery({
    prompt: silence(),
    options: { settingSources: [], abortController: controller, ...process.options },
  });
  try {
    return await session.supportedModels();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export class ModelCatalog {
  readonly #runtime: ClaudeRuntime;
  readonly #timeoutMs: number;
  #catalog: Promise<AgentModel[]> | null = null;

  constructor(runtime: ClaudeRuntime = CLAUDE_RUNTIME, timeoutMs = CATALOG_TIMEOUT_MS) {
    this.#runtime = runtime;
    this.#timeoutMs = timeoutMs;
  }

  list(): Promise<AgentModel[]> {
    this.#catalog ??= this.#request();
    return this.#catalog;
  }

  async #request() {
    try {
      const models = resolveModels(await requestSdkModels(this.#runtime, this.#timeoutMs));
      if (models.length === 0) throw new Error('The agent reported no models.');
      return models;
    } catch (error) {
      log.warn('[Models] Falling back to the built-in list', { error: describeError(error) });
      this.#catalog = null;
      return KNOWN_AGENT_MODELS;
    }
  }
}
