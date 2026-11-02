import { type AgentProvider, type JsonSchema, resolveCapabilities } from '../providers/index.ts';
import { JSON_ONLY, type QuickMode, type QuickRequest } from './schema.ts';

export function listModes(provider: AgentProvider, schema: JsonSchema | null): QuickMode[] {
  const structured =
    schema !== null && resolveCapabilities(provider).structuredOutput && provider.completeStructured;
  return structured ? ['structured', 'text'] : ['text'];
}

export function resolveTextSystem(system: string, schema: JsonSchema | null) {
  if (!schema) return `${system}\n${JSON_ONLY}`;
  return `${system}\n${JSON_ONLY}\nIt must match this JSON schema:\n${JSON.stringify(schema)}`;
}

export function resolveQuickModel<T>(request: QuickRequest<T>, provider: AgentProvider) {
  return typeof request.model === 'string' ? request.model : request.model(provider.id);
}
