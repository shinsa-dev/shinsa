import { BunServices } from '@effect/platform-bun';
import { Layer } from 'effect';
import { JsonFile } from '../../src/files/service.ts';

export const JsonFileLayer = JsonFile.layer.pipe(Layer.provideMerge(BunServices.layer));
