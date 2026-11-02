import type { PluginSummary } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { serializePluginSummary } from './discovery/plugins.ts';
import { ExtensionDiscovery } from './discovery/service.ts';
import type { ClaudePlugin, PluginParts } from './schema.ts';

export function resolvePluginSummary(
  plugin: ClaudePlugin,
  parts: PluginParts,
  enabled: boolean,
  userHome: string
): PluginSummary {
  const files = edgeRuntime.runSync(ExtensionDiscovery.use((discovery) => discovery.readPluginFiles(plugin)));
  return serializePluginSummary(plugin, files, parts, enabled, userHome);
}
