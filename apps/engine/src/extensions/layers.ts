import { Layer } from 'effect';
import { ExtensionDiscovery } from './discovery/service.ts';
import { McpClients } from './health/service.ts';
import { ExtensionLoader } from './loader/service.ts';
import type { McpOAuthInput } from './oauth/schema.ts';
import { McpOAuth } from './oauth/service.ts';
import { Extensions } from './registry/service.ts';
import type { Env } from './schema.ts';
import { ExtensionStore } from './settings/service.ts';
import { ExtensionFiles } from './store/service.ts';
import { UsageIndex } from './usage-index/service.ts';
import { ExtensionUsage } from './usage/service.ts';

export const ExtensionsLayer = Layer.mergeAll(
  ExtensionUsage.layer,
  ExtensionDiscovery.layer,
  McpClients.layer
).pipe(Layer.provideMerge(ExtensionFiles.layer));

export const ExtensionsServices = (input: McpOAuthInput & { readonly env: Env }) =>
  Extensions.layer(input.env).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ExtensionStore.layer,
        UsageIndex.layer(input.env),
        McpOAuth.layer(input),
        ExtensionLoader.layer
      )
    )
  );
