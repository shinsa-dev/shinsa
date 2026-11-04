import { Layer } from 'effect';
import { ShellLayer } from '../../../apps/engine/src/shell/layers.ts';
import { Command } from './service.ts';

export const CommandLayer = Command.layer.pipe(Layer.provideMerge(ShellLayer));
