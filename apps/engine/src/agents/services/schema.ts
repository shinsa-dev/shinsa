import type { ShinsaState, Task } from '@shinsa/core';
import type { Terminals } from '../../terminals/index.ts';

export const SERVICE_OUTPUT_LINES = 60;

export const SERVICE_ACTIONS = ['start', 'stop', 'restart'] as const;

export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export type ServiceToolName = 'list_services' | 'run_service' | 'add_service' | 'remove_service';

type TaskServiceRunner = Pick<
  Terminals['Service'],
  | 'home'
  | 'dataDir'
  | 'snapshot'
  | 'startService'
  | 'stopService'
  | 'restartService'
  | 'readServiceOutput'
  | 'addService'
  | 'removeServices'
>;

export interface ServiceToolContext {
  readonly state: ShinsaState;
  readonly task: Task;
  readonly runner: TaskServiceRunner;
  readonly now: number;
}
