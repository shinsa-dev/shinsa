import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { EdgeWorkspace } from './edge.ts';
import { MainCheckoutWorkspace } from './main-checkout-mode/service.ts';

export class MainCheckoutStrategy extends EdgeWorkspace {
  constructor() {
    super(edgeRuntime.runSync(MainCheckoutWorkspace.use((main) => Effect.succeed(main.workspace))));
  }
}
