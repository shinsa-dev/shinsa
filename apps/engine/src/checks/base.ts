import { edgeRuntime } from '../runtime/edge.ts';
import { BaseCheckoutPools } from './base/service.ts';
import type { BaseCheckoutPool, BaseRequest, FailureDiff } from './schema.ts';

export type { BaseRequest } from './schema.ts';

export class BaseCheckouts {
  readonly #pool: BaseCheckoutPool;

  constructor(dir: string, keep?: number) {
    this.#pool = edgeRuntime.runSync(BaseCheckoutPools.useSync((pools) => pools.make(dir, keep)));
  }

  compareWithBase(request: BaseRequest): Promise<FailureDiff | null> {
    return edgeRuntime.runPromise(this.#pool.compare(request));
  }
}
