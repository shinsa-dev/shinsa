import { edgeRuntime } from '../runtime/edge.ts';
import { ExtensionDiscovery } from './discovery/service.ts';
import type { ClaudePlugin, DiscoveryPaths } from './schema.ts';

export type { ClaudePlugin, DiscoveryPaths } from './schema.ts';

export function listClaudePlugins(paths: DiscoveryPaths, problems: string[]): ClaudePlugin[] {
  const read = edgeRuntime.runSync(ExtensionDiscovery.use((discovery) => discovery.listPlugins(paths)));
  problems.push(...read.problems);
  return read.plugins;
}

export function discoverServers(paths: DiscoveryPaths, plugins: ClaudePlugin[], problems: string[]) {
  const read = edgeRuntime.runSync(
    ExtensionDiscovery.use((discovery) => discovery.listServers(paths, plugins))
  );
  problems.push(...read.problems);
  return read.servers;
}
