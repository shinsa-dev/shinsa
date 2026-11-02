import { ManagedRuntime } from 'effect';
import { JsonLogger } from '../log/service.ts';

export const edgeRuntime = ManagedRuntime.make(JsonLogger);
