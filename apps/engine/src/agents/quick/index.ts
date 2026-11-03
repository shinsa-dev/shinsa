import { resolveAgentFastMode, resolveAgentModel, resolveAgentProvider, type Settings } from '@shinsa/core';
import { edgeRuntime } from '../../runtime/edge.ts';
import type { AgentProvider, JsonSchema, ProviderRegistry } from '../providers/index.ts';
import { parseObject } from './json.ts';
import type { FastModeReader, QuickJson, QuickRequest, QuickResult, QuickRole } from './schema.ts';
import { requestQuick } from './service.ts';

export { parseJsonObject } from './json.ts';
export type { FastModeReader, QuickJson, QuickRequest } from './schema.ts';

export function requestQuickStructured<T>(
  request: QuickRequest<T>,
  providers: AgentProvider[]
): Promise<QuickResult<T>> {
  return edgeRuntime.runPromise(requestQuick(request, providers));
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
  role: QuickRole,
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
