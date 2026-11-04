import { Layer } from 'effect';
import { ShellLayer } from '../shell/layers.ts';
import { CatFiles } from './blobs/service.ts';
import { Checkout } from './checkout/service.ts';
import { History } from './history/service.ts';
import { LeftoverProcesses } from './leftovers/service.ts';
import { ObjectCache } from './objects/service.ts';
import { Remote } from './remote/service.ts';
import { Git } from './service.ts';
import { CodeFiles } from './tree/service.ts';

export const GitLayer = Layer.mergeAll(Checkout.layer, Remote.layer, History.layer, CodeFiles.layer).pipe(
  Layer.provideMerge(Layer.merge(Git.layer, ObjectCache.layer)),
  Layer.merge(Layer.merge(LeftoverProcesses.layer, CatFiles.layer))
);

export const GitCommands = Git.layer.pipe(Layer.provide(ShellLayer));
