import { Layer } from 'effect';
import { TaskCoverage } from '../test-coverage/service.ts';
import { BaseCheckoutPools } from './base/service.ts';
import { SharedCaches } from './caches/service.ts';
import { CheckRunner } from './runner/service.ts';

export const ChecksLayer = Layer.merge(BaseCheckoutPools.layer, TaskCoverage.layer).pipe(
  Layer.provideMerge(CheckRunner.layer),
  Layer.merge(SharedCaches.layer)
);
