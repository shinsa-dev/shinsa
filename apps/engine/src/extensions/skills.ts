import { edgeRuntime } from '../runtime/edge.ts';
import { ExtensionDiscovery } from './discovery/service.ts';
import { listSkillRoots } from './discovery/skills.ts';
import type { ClaudePlugin, DiscoveryPaths } from './schema.ts';

export type { FoundSkill } from './schema.ts';
export { parseFrontmatter } from './discovery/skills.ts';

export function discoverSkills(paths: DiscoveryPaths, plugins: ClaudePlugin[], pluginDir: string) {
  return edgeRuntime.runSync(
    ExtensionDiscovery.use((discovery) => discovery.listSkills(listSkillRoots(paths, plugins, pluginDir)))
  );
}
