import { BunServices } from '@effect/platform-bun';
import { Layer } from 'effect';
import { Shell } from './service.ts';

export const ShellLayer = Shell.layer.pipe(Layer.provideMerge(BunServices.layer));
