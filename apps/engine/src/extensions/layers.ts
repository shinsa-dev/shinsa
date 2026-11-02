import { Layer } from 'effect';
import { ExtensionDiscovery } from './discovery/service.ts';
import { McpClients } from './health/service.ts';
import { ExtensionFiles } from './store/service.ts';
import { ExtensionUsage } from './usage/service.ts';

export const ExtensionsLayer = Layer.mergeAll(
  ExtensionUsage.layer,
  ExtensionDiscovery.layer,
  McpClients.layer
).pipe(Layer.provideMerge(ExtensionFiles.layer));
