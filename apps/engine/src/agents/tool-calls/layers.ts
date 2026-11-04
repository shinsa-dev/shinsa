import { Layer } from 'effect';
import { Deliveries } from '../deliveries/service.ts';
import { Questions } from '../questions/service.ts';
import { RepositoryWork } from '../repository-work/service.ts';
import { ToolCalls } from './service.ts';

export const ToolCallsLayer = Layer.merge(ToolCalls.layer, Deliveries.layer).pipe(
  Layer.provideMerge(Layer.merge(Questions.layer, RepositoryWork.layer))
);
