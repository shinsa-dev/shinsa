import { BunServices } from '@effect/platform-bun';
import { Layer, ManagedRuntime } from 'effect';
import { MachineConfigFile } from '../config/machine/service.ts';
import { JsonFile } from '../files/service.ts';
import { GitLayer } from '../git/layers.ts';
import { JsonLogger } from '../log/service.ts';
import { Shell } from '../shell/service.ts';

const ShellLayer = Shell.layer.pipe(Layer.provideMerge(BunServices.layer));

export const edgeRuntime = ManagedRuntime.make(
  Layer.mergeAll(
    JsonLogger,
    MachineConfigFile.layer,
    JsonFile.layer,
    GitLayer.pipe(Layer.provideMerge(ShellLayer))
  )
);
