import { Layer } from 'effect';
import { TaskCoverage } from '../test-coverage/service.ts';
import { SharedCaches } from './caches/service.ts';
import { CheckRunner } from './runner/service.ts';

export const ChecksLayer = TaskCoverage.layer.pipe(
  Layer.provideMerge(CheckRunner.layer),
  Layer.merge(SharedCaches.layer)
);
