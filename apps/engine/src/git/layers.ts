import { Layer } from 'effect';
import { Checkout } from './checkout/service.ts';
import { History } from './history/service.ts';
import { LeftoverProcesses } from './leftovers/service.ts';
import { Remote } from './remote/service.ts';
import { Git } from './service.ts';
import { CodeFiles } from './tree/service.ts';

export const GitLayer = Layer.mergeAll(Checkout.layer, Remote.layer, History.layer, CodeFiles.layer).pipe(
  Layer.provideMerge(Git.layer),
  Layer.merge(LeftoverProcesses.layer)
);
