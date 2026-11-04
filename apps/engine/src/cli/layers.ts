import { Layer } from 'effect';
import { MachineConfigFile } from '../config/machine/service.ts';
import { Remote } from '../git/remote/service.ts';
import { Git } from '../git/service.ts';
import { JsonLogger } from '../log/service.ts';
import { ShellLayer } from '../shell/layers.ts';

export const CliLayer = Layer.mergeAll(
  JsonLogger,
  MachineConfigFile.layer,
  Remote.layer.pipe(Layer.provide(Git.layer))
).pipe(Layer.provideMerge(ShellLayer));
