import type {
  DelegationQuestion,
  DelegationWake,
  DeliveryClaim,
  DeliveryVia,
  QueuedMessage,
  RunWait,
  TaskSplit,
} from '../domain/index.ts';

export type DelegationEventBody =
  | { type: 'delegation.asked'; runId: string; question: DelegationQuestion }
  | { type: 'delegation.answered'; runId: string; questionId: string; answer: string }
  | { type: 'delegation.acknowledged'; runId: string }
  | { type: 'delegation.wake_changed'; runId: string; wake: DelegationWake }
  | { type: 'delegation.adopted'; runId: string; parentRunId: string }
  | { type: 'delegation.claimed'; runId: string; claim: DeliveryClaim }
  | { type: 'delegation.delivered'; runId: string; generation: number; items: string[]; via: DeliveryVia }
  | {
      type: 'delegation.released';
      runId: string;
      generation: number | null;
      items: string[];
      deferred: boolean;
    }
  | { type: 'delegation.message_queued'; runId: string; message: QueuedMessage }
  | { type: 'run.waiting'; runId: string; wait: RunWait }
  | { type: 'task.split'; taskId: string; split: TaskSplit };
