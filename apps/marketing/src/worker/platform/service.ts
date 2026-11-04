import { Context, type Option } from 'effect';
import type { AssetsBinding, BucketBinding, CacheBinding } from './schema.ts';

export class WorkerBindings extends Context.Service<
  WorkerBindings,
  {
    readonly assets: AssetsBinding;
    readonly downloads: Option.Option<BucketBinding>;
    readonly cache: Option.Option<CacheBinding>;
  }
>()('shinsa/marketing/worker/platform/WorkerBindings') {}
