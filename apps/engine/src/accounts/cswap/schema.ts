import type { CswapAccount } from '../schema.ts';

export interface CswapListing {
  readonly at: number;
  readonly accounts: CswapAccount[];
}
