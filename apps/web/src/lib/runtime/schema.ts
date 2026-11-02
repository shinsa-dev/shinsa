import type { EngineClient } from './engine/service.ts';
import type { RemoteClient } from './remote/service.ts';

export type AppServices = EngineClient | RemoteClient;
