import type { Engine } from '../../runtime/engine.ts';
import { type ActiveRun } from '../active/schema.ts';
import { type Delivery } from '../delegations/schema.ts';
import type { Transcripts } from '../transcripts/index.ts';

export interface DeliveriesOptions {
  engine: Engine;
  transcripts: Transcripts;
  active: ReadonlyMap<string, ActiveRun>;
  execute: (runId: string, prompt: string, delivery: Delivery) => Promise<void>;
}
