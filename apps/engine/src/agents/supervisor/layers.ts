import { Layer } from 'effect';
import { AccountLeasing } from '../accounts/service.ts';
import { SessionExtensionSets } from '../extension-sets/service.ts';
import { RunSupervisor } from './service.ts';

export const RunSupervisorLayer = RunSupervisor.layer.pipe(
  Layer.provide(Layer.merge(AccountLeasing.layer, SessionExtensionSets.layer))
);
