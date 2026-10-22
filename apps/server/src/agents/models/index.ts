import { type ModelInfo, query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { type AgentModel, KNOWN_AGENT_MODELS, resolveModelFamily, resolveModelLabel } from '@shinsa/core';
import { describeError, log } from '../../log/index.ts';
import { type QueryFn, resolveClaudeProcess } from '../claude/sdk.ts';

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

async function requestSdkModels(runQuery: QueryFn, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const session = runQuery({
    prompt: silence(),
    options: { settingSources: [], abortController: controller, ...resolveClaudeProcess() },
  });
  try {
    return await session.supportedModels();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export class ModelCatalog {
  readonly #runQuery: QueryFn;
  readonly #timeoutMs: number;
  #catalog: Promise<AgentModel[]> | null = null;

  constructor(runQuery: QueryFn = query, timeoutMs = CATALOG_TIMEOUT_MS) {
    this.#runQuery = runQuery;
    this.#timeoutMs = timeoutMs;
  }

  list(): Promise<AgentModel[]> {
    this.#catalog ??= this.#request();
    return this.#catalog;
  }

  async #request() {
    try {
      const models = resolveModels(await requestSdkModels(this.#runQuery, this.#timeoutMs));
      if (models.length === 0) throw new Error('The agent reported no models.');
      return models;
    } catch (error) {
      log.warn('[Models] Falling back to the built-in list', { error: describeError(error) });
      this.#catalog = null;
      return KNOWN_AGENT_MODELS;
    }
  }
}
